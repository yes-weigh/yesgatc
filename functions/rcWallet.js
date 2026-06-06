const crypto = require('crypto');
const { Busboy } = require('@fastify/busboy');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;
const ALLOWED_SCREENSHOT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function walletRef(db, rcId) {
  return db.doc(`rcWallets/${rcId}`);
}

function topUpRef(db, topUpId) {
  return db.doc(`walletTopUps/${topUpId}`);
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function assertRcAdmin(db, uid, rcId) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'rc_admin' || uid !== rcId) {
    throw new HttpsError('permission-denied', 'RC Admin only.');
  }
}

/**
 * Super Admin approves or rejects a wallet top-up request.
 * On approve, increments rcWallets/{rcId}.balanceInr atomically.
 */
async function reviewWalletTopUpHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  await assertSuperAdmin(db, request.auth.uid);

  const topUpId = request.data?.topUpId;
  const action = request.data?.action;
  const rejectionReason =
    typeof request.data?.rejectionReason === 'string' ? request.data.rejectionReason.trim() : '';

  if (!topUpId || typeof topUpId !== 'string') {
    throw new HttpsError('invalid-argument', 'topUpId is required.');
  }
  if (action !== 'approve' && action !== 'reject') {
    throw new HttpsError('invalid-argument', 'action must be approve or reject.');
  }
  if (action === 'reject' && !rejectionReason) {
    throw new HttpsError('invalid-argument', 'Rejection reason is required.');
  }

  const reviewedAt = new Date().toISOString();
  const reviewedByUid = request.auth.uid;

  return db.runTransaction(async transaction => {
    const topUpSnap = await transaction.get(topUpRef(db, topUpId));
    if (!topUpSnap.exists) {
      throw new HttpsError('not-found', 'Top-up request not found.');
    }

    const topUp = topUpSnap.data();
    if (topUp.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This top-up was already reviewed.');
    }

    const rcId = topUp.rcId;
    const amountInr = Number(topUp.amountInr);
    if (!rcId || !Number.isFinite(amountInr) || amountInr <= 0) {
      throw new HttpsError('failed-precondition', 'Invalid top-up amount.');
    }

    const walletSnap = await transaction.get(walletRef(db, rcId));
    const currentBalance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;

    if (action === 'reject') {
      transaction.update(topUpRef(db, topUpId), {
        status: 'rejected',
        reviewedAt,
        reviewedByUid,
        rejectionReason,
      });
      return {
        topUpId,
        status: 'rejected',
        balanceInr: currentBalance,
      };
    }

    const nextBalance = Math.round((currentBalance + amountInr) * 100) / 100;
    transaction.set(
      walletRef(db, rcId),
      {
        rcId,
        balanceInr: nextBalance,
        updatedAt: reviewedAt,
      },
      { merge: true },
    );
    transaction.update(topUpRef(db, topUpId), {
      status: 'approved',
      reviewedAt,
      reviewedByUid,
      rejectionReason: FieldValue.delete(),
    });

    return {
      topUpId,
      status: 'approved',
      balanceInr: nextBalance,
    };
  });
}

/**
 * Debits RC wallet for RV administrative fees + GST before verification submit.
 */
async function payRvFromWalletHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const rcId = request.data?.rcId;
  const amountInr = Number(request.data?.amountInr);

  if (!rcId || typeof rcId !== 'string') {
    throw new HttpsError('invalid-argument', 'rcId is required.');
  }
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    throw new HttpsError('invalid-argument', 'amountInr must be a positive number.');
  }

  await assertRcAdmin(db, request.auth.uid, rcId);

  const paidAt = new Date().toISOString();

  return db.runTransaction(async transaction => {
    const walletSnap = await transaction.get(walletRef(db, rcId));
    const currentBalance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;

    if (currentBalance < amountInr) {
      throw new HttpsError(
        'failed-precondition',
        `Insufficient wallet balance. Available ₹${currentBalance.toFixed(2)}, required ₹${amountInr.toFixed(2)}.`,
      );
    }

    const nextBalance = Math.round((currentBalance - amountInr) * 100) / 100;
    const ledgerId = `rv-${Date.now()}-${request.auth.uid.slice(0, 6)}`;

    transaction.set(
      walletRef(db, rcId),
      {
        rcId,
        balanceInr: nextBalance,
        updatedAt: paidAt,
      },
      { merge: true },
    );

    transaction.set(db.doc(`walletLedger/${ledgerId}`), {
      rcId,
      type: 'rv_payment',
      amountInr: -amountInr,
      balanceAfterInr: nextBalance,
      recordIds: Array.isArray(request.data?.recordIds) ? request.data.recordIds : [],
      createdAt: paidAt,
      createdByUid: request.auth.uid,
    });

    return {
      paymentId: `wallet:${ledgerId}`,
      amountInr,
      balanceInr: nextBalance,
    };
  });
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function setWalletTopUpCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};
    const busboy = new Busboy({ headers: req.headers });

    busboy.on('field', (fieldname, value) => {
      fields[fieldname] = value;
    });

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => {
        files[fieldname] = {
          buffer: Buffer.concat(chunks),
          filename,
          mimeType,
        };
      });
      file.on('error', reject);
    });

    busboy.on('close', () => resolve({ fields, files }));
    busboy.on('error', reject);

    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }
  });
}

async function verifyBearerToken(req, auth) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw httpError(401, 'Sign in required.');
  }
  const decoded = await auth.verifyIdToken(header.slice(7));
  return decoded.uid;
}

function buildStorageDownloadUrl(bucketName, storagePath, token) {
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media&token=${token}`;
}

async function uploadWalletScreenshot(buffer, contentType, topUpId, originalName) {
  const bucket = getStorage().bucket();
  const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : '';
  const storagePath = `walletTopUps/${topUpId}/screenshot/${Date.now()}${ext}`;
  const token = crypto.randomUUID();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  return {
    url: buildStorageDownloadUrl(bucket.name, storagePath, token),
    path: storagePath,
    name: originalName || 'screenshot',
    contentType,
  };
}

/**
 * RC Admin submits a wallet top-up with payment screenshot (multipart HTTP).
 * Uploads via Admin SDK so client Storage rules are not required.
 */
async function submitWalletTopUpHttpHandler(req, res, db, auth) {
  setWalletTopUpCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const uid = await verifyBearerToken(req, auth);
    await assertRcAdmin(db, uid, uid);

    const { fields, files } = await parseMultipart(req);
    const amountInr = Number(fields.amountInr);
    const note = typeof fields.note === 'string' ? fields.note.trim() : '';
    const screenshot = files.screenshot;

    if (!screenshot?.buffer?.length) {
      throw httpError(400, 'Payment screenshot is required.');
    }
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      throw httpError(400, 'Enter a valid payment amount.');
    }
    if (screenshot.buffer.length > MAX_SCREENSHOT_BYTES) {
      throw httpError(400, 'File must be 15 MB or smaller.');
    }

    const contentType = screenshot.mimeType || 'application/octet-stream';
    if (!ALLOWED_SCREENSHOT_TYPES.has(contentType)) {
      throw httpError(400, 'Screenshot must be JPEG, PNG, or WebP.');
    }

    const topUpId = crypto.randomUUID();
    const profileSnap = await db.doc(`users/${uid}`).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};

    const screenshotMeta = await uploadWalletScreenshot(
      screenshot.buffer,
      contentType,
      topUpId,
      screenshot.filename || 'screenshot.jpg',
    );

    await db.doc(`walletTopUps/${topUpId}`).set({
      rcId: uid,
      rcCompanyName: profile.companyName?.trim() || profile.username?.trim() || '',
      amountInr: Math.round(amountInr * 100) / 100,
      status: 'pending',
      screenshotUrl: screenshotMeta.url,
      screenshotPath: screenshotMeta.path,
      screenshotName: screenshotMeta.name,
      screenshotContentType: screenshotMeta.contentType,
      note,
      submittedAt: new Date().toISOString(),
      submittedByUid: uid,
    });

    res.status(200).json({ topUpId });
  } catch (err) {
    const status = err.statusCode || (err instanceof HttpsError ? 403 : 500);
    const message =
      err instanceof HttpsError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not submit top-up.';
    res.status(status).json({ error: message });
  }
}

module.exports = {
  reviewWalletTopUpHandler,
  payRvFromWalletHandler,
  submitWalletTopUpHttpHandler,
};
