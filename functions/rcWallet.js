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

function ledgerRef(db, ledgerId) {
  return db.doc(`walletLedger/${ledgerId}`);
}

function roundInr(value) {
  return Math.round(Number(value) * 100) / 100;
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

async function isRvWalletEnabled(db) {
  const snap = await db.doc('appSettings/global').get();
  if (!snap.exists) return false;
  return snap.data()?.rvWalletEnabled === true;
}

function validatePaymentBreakdown(breakdown, amountInr) {
  if (!breakdown || typeof breakdown !== 'object') {
    throw new HttpsError('invalid-argument', 'Payment breakdown is required.');
  }

  const administrativeFees = Number(breakdown.administrativeFees);
  const gst = Number(breakdown.gst);
  const total = Number(breakdown.total);

  if (!Number.isFinite(administrativeFees) || administrativeFees < 0) {
    throw new HttpsError('invalid-argument', 'Invalid administrative fees in breakdown.');
  }
  if (!Number.isFinite(gst) || gst < 0) {
    throw new HttpsError('invalid-argument', 'Invalid GST in breakdown.');
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new HttpsError('invalid-argument', 'Invalid payment total in breakdown.');
  }

  const expectedTotal = roundInr(administrativeFees + gst);
  if (roundInr(total) !== expectedTotal) {
    throw new HttpsError('invalid-argument', 'Payment breakdown total does not match fees + GST.');
  }

  const normalizedAmount = roundInr(amountInr);
  if (normalizedAmount !== roundInr(total)) {
    throw new HttpsError('invalid-argument', 'Payment amount does not match breakdown total.');
  }

  return normalizedAmount;
}

function sanitizeIdempotencyKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return '';
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function ledgerIdFromPaymentId(paymentId) {
  if (typeof paymentId !== 'string' || !paymentId.startsWith('wallet:')) {
    throw new HttpsError('invalid-argument', 'Invalid wallet payment id.');
  }
  const ledgerId = paymentId.slice('wallet:'.length).trim();
  if (!ledgerId) {
    throw new HttpsError('invalid-argument', 'Invalid wallet payment id.');
  }
  return ledgerId;
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

    const nextBalance = roundInr(currentBalance + amountInr);
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
    transaction.set(ledgerRef(db, `topup-${topUpId}`), {
      rcId,
      type: 'top_up_credit',
      topUpId,
      amountInr: roundInr(amountInr),
      balanceAfterInr: nextBalance,
      status: 'completed',
      createdAt: reviewedAt,
      createdByUid: reviewedByUid,
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

  if (!(await isRvWalletEnabled(db))) {
    throw new HttpsError('failed-precondition', 'RV wallet payments are disabled.');
  }

  const rcId = request.data?.rcId;
  const amountInr = validatePaymentBreakdown(request.data?.breakdown, Number(request.data?.amountInr));
  const idempotencyKey = sanitizeIdempotencyKey(request.data?.idempotencyKey);
  const recordIds = Array.isArray(request.data?.recordIds)
    ? request.data.recordIds.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!rcId || typeof rcId !== 'string') {
    throw new HttpsError('invalid-argument', 'rcId is required.');
  }

  await assertRcAdmin(db, request.auth.uid, rcId);

  const ledgerId = idempotencyKey
    ? `rv-${idempotencyKey}`
    : `rv-${Date.now()}-${request.auth.uid.slice(0, 6)}`;
  const paymentId = `wallet:${ledgerId}`;
  const paidAt = new Date().toISOString();

  return db.runTransaction(async transaction => {
    const existingLedgerSnap = await transaction.get(ledgerRef(db, ledgerId));
    if (existingLedgerSnap.exists) {
      const existing = existingLedgerSnap.data();
      if (existing.status === 'completed' && existing.type === 'rv_payment') {
        return {
          paymentId,
          amountInr: Number(existing.amountInr) || amountInr,
          balanceInr: Number(existing.balanceAfterInr) || 0,
          reused: true,
        };
      }
      if (existing.status === 'refunded') {
        throw new HttpsError('failed-precondition', 'This payment was refunded. Start a new payment.');
      }
    }

    const walletSnap = await transaction.get(walletRef(db, rcId));
    const currentBalance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;

    if (currentBalance < amountInr) {
      throw new HttpsError(
        'failed-precondition',
        `Insufficient wallet balance. Available ₹${currentBalance.toFixed(2)}, required ₹${amountInr.toFixed(2)}.`,
      );
    }

    const nextBalance = roundInr(currentBalance - amountInr);

    transaction.set(
      walletRef(db, rcId),
      {
        rcId,
        balanceInr: nextBalance,
        updatedAt: paidAt,
      },
      { merge: true },
    );

    transaction.set(ledgerRef(db, ledgerId), {
      rcId,
      type: 'rv_payment',
      amountInr: -amountInr,
      balanceAfterInr: nextBalance,
      recordIds,
      status: 'completed',
      idempotencyKey: idempotencyKey || null,
      createdAt: paidAt,
      createdByUid: request.auth.uid,
    });

    return {
      paymentId,
      amountInr,
      balanceInr: nextBalance,
      reused: false,
    };
  });
}

/**
 * Refunds a wallet RV payment if verification submit fails after debit.
 */
async function refundRvWalletPaymentHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const paymentId = request.data?.paymentId;
  const reason =
    typeof request.data?.reason === 'string' && request.data.reason.trim()
      ? request.data.reason.trim()
      : 'Verification submit failed';

  const ledgerId = ledgerIdFromPaymentId(paymentId);
  const refundedAt = new Date().toISOString();

  const ledgerSnap = await ledgerRef(db, ledgerId).get();
  if (!ledgerSnap.exists) {
    throw new HttpsError('not-found', 'Wallet payment not found.');
  }

  const ledger = ledgerSnap.data();
  if (ledger.type !== 'rv_payment') {
    throw new HttpsError('failed-precondition', 'Only RV wallet payments can be refunded.');
  }

  await assertRcAdmin(db, request.auth.uid, ledger.rcId);

  return db.runTransaction(async transaction => {
    const freshLedgerSnap = await transaction.get(ledgerRef(db, ledgerId));
    if (!freshLedgerSnap.exists) {
      throw new HttpsError('not-found', 'Wallet payment not found.');
    }

    const freshLedger = freshLedgerSnap.data();
    if (freshLedger.status === 'refunded') {
      const walletSnap = await transaction.get(walletRef(db, freshLedger.rcId));
      const balanceInr = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;
      return {
        paymentId,
        balanceInr,
        refunded: true,
        reused: true,
      };
    }

    const debitAmount = Math.abs(Number(freshLedger.amountInr) || 0);
    if (debitAmount <= 0) {
      throw new HttpsError('failed-precondition', 'Invalid ledger amount.');
    }

    const walletSnap = await transaction.get(walletRef(db, freshLedger.rcId));
    const currentBalance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;
    const nextBalance = roundInr(currentBalance + debitAmount);

    transaction.set(
      walletRef(db, freshLedger.rcId),
      {
        rcId: freshLedger.rcId,
        balanceInr: nextBalance,
        updatedAt: refundedAt,
      },
      { merge: true },
    );

    transaction.set(
      ledgerRef(db, ledgerId),
      {
        status: 'refunded',
        refundedAt,
        refundReason: reason,
        refundedByUid: request.auth.uid,
      },
      { merge: true },
    );

    transaction.set(ledgerRef(db, `${ledgerId}-refund`), {
      rcId: freshLedger.rcId,
      type: 'rv_refund',
      amountInr: debitAmount,
      balanceAfterInr: nextBalance,
      relatedPaymentId: paymentId,
      status: 'completed',
      refundReason: reason,
      createdAt: refundedAt,
      createdByUid: request.auth.uid,
    });

    return {
      paymentId,
      balanceInr: nextBalance,
      refunded: true,
      reused: false,
    };
  });
}

/**
 * Attach created verification record ids to a wallet payment ledger entry.
 */
async function linkWalletPaymentToRecordsHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const paymentId = request.data?.paymentId;
  const recordIds = Array.isArray(request.data?.recordIds)
    ? request.data.recordIds.filter(id => typeof id === 'string' && id.trim())
    : [];

  if (!recordIds.length) {
    throw new HttpsError('invalid-argument', 'recordIds is required.');
  }

  const ledgerId = ledgerIdFromPaymentId(paymentId);

  const ledgerSnap = await ledgerRef(db, ledgerId).get();
  if (!ledgerSnap.exists) {
    throw new HttpsError('not-found', 'Wallet payment not found.');
  }

  const ledger = ledgerSnap.data();
  await assertRcAdmin(db, request.auth.uid, ledger.rcId);

  await ledgerRef(db, ledgerId).set({ recordIds }, { merge: true });
  return { paymentId, recordIds };
}

async function getWalletApiConfigHandler(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'yesgatc';
  const region = process.env.FUNCTION_REGION || 'us-central1';
  const submitTopUpUrl =
    process.env.SUBMIT_WALLET_TOP_UP_URL?.trim()
    || `https://${region}-${projectId}.cloudfunctions.net/submitWalletTopUp`;

  return { submitTopUpUrl };
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

function readRequestBody(req) {
  if (req.rawBody) {
    return Promise.resolve(Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartBuffer(buffer, headers) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};
    const pendingFiles = [];
    const busboy = new Busboy({ headers });

    busboy.on('field', (fieldname, value) => {
      fields[fieldname] = value;
    });

    busboy.on('file', (fieldname, file, info) => {
      const { filename, mimeType } = info;
      const fileDone = new Promise((res, rej) => {
        const chunks = [];
        file.on('data', chunk => chunks.push(chunk));
        file.on('end', () => {
          files[fieldname] = {
            buffer: Buffer.concat(chunks),
            filename,
            mimeType,
          };
          res();
        });
        file.on('error', rej);
      });
      pendingFiles.push(fileDone);
    });

    busboy.on('close', () => {
      Promise.all(pendingFiles)
        .then(() => resolve({ fields, files }))
        .catch(reject);
    });
    busboy.on('error', reject);

    busboy.end(buffer);
  });
}

async function parseMultipart(req) {
  const buffer = await readRequestBody(req);
  if (!buffer.length) {
    throw httpError(400, 'Request body is empty.');
  }
  return parseMultipartBuffer(buffer, req.headers);
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

async function deleteWalletScreenshot(storagePath) {
  if (!storagePath) return;
  try {
    await getStorage().bucket().file(storagePath).delete({ ignoreNotFound: true });
  } catch (err) {
    console.warn('Failed to delete orphan wallet screenshot', storagePath, err);
  }
}

async function assertNoDuplicatePendingTopUp(db, rcId, amountInr) {
  const pendingSnap = await db
    .collection('walletTopUps')
    .where('rcId', '==', rcId)
    .where('status', '==', 'pending')
    .limit(20)
    .get();

  const normalized = roundInr(amountInr);
  const duplicate = pendingSnap.docs.find(doc => roundInr(doc.data().amountInr) === normalized);
  if (duplicate) {
    throw new HttpsError(
      'already-exists',
      'You already have a pending top-up for this amount. Wait for Super Admin approval or use a different amount.',
    );
  }
}

function validateWalletScreenshotBuffer(buffer, contentType) {
  if (!buffer?.length) {
    throw new HttpsError('invalid-argument', 'Payment screenshot is required.');
  }
  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new HttpsError('invalid-argument', 'File must be 15 MB or smaller.');
  }
  const normalizedType = contentType || 'application/octet-stream';
  if (!ALLOWED_SCREENSHOT_TYPES.has(normalizedType)) {
    throw new HttpsError('invalid-argument', 'Screenshot must be JPEG, PNG, or WebP.');
  }
  return normalizedType;
}

async function processWalletTopUpSubmission(
  db,
  uid,
  { amountInr, note, screenshotBuffer, screenshotContentType, screenshotName },
) {
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    throw new HttpsError('invalid-argument', 'Enter a valid payment amount.');
  }

  const normalizedAmount = roundInr(amountInr);
  await assertNoDuplicatePendingTopUp(db, uid, normalizedAmount);

  const contentType = validateWalletScreenshotBuffer(screenshotBuffer, screenshotContentType);
  const topUpId = crypto.randomUUID();
  const profileSnap = await db.doc(`users/${uid}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : {};

  const screenshotMeta = await uploadWalletScreenshot(
    screenshotBuffer,
    contentType,
    topUpId,
    screenshotName || 'screenshot.jpg',
  );

  try {
    await db.doc(`walletTopUps/${topUpId}`).set({
      rcId: uid,
      rcCompanyName: profile.companyName?.trim() || profile.username?.trim() || '',
      amountInr: normalizedAmount,
      status: 'pending',
      screenshotUrl: screenshotMeta.url,
      screenshotPath: screenshotMeta.path,
      screenshotName: screenshotMeta.name,
      screenshotContentType: screenshotMeta.contentType,
      note: typeof note === 'string' ? note.trim() : '',
      submittedAt: new Date().toISOString(),
      submittedByUid: uid,
    });
  } catch (err) {
    await deleteWalletScreenshot(screenshotMeta.path);
    throw err;
  }

  return { topUpId };
}

/**
 * Callable wallet top-up submit (base64 screenshot). Preferred over HTTP multipart on Gen2.
 */
async function submitWalletTopUpCallableHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const uid = request.auth.uid;
  await assertRcAdmin(db, uid, uid);

  const amountInr = Number(request.data?.amountInr);
  const note = typeof request.data?.note === 'string' ? request.data.note : '';
  const screenshotBase64 =
    typeof request.data?.screenshotBase64 === 'string' ? request.data.screenshotBase64.trim() : '';
  const screenshotContentType =
    typeof request.data?.screenshotContentType === 'string'
      ? request.data.screenshotContentType.trim()
      : 'image/jpeg';
  const screenshotName =
    typeof request.data?.screenshotName === 'string' ? request.data.screenshotName.trim() : 'screenshot.jpg';

  if (!screenshotBase64) {
    throw new HttpsError('invalid-argument', 'Payment screenshot is required.');
  }

  let screenshotBuffer;
  try {
    screenshotBuffer = Buffer.from(screenshotBase64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'Payment screenshot is invalid.');
  }

  if (!screenshotBuffer.length) {
    throw new HttpsError('invalid-argument', 'Payment screenshot is required.');
  }

  return processWalletTopUpSubmission(db, uid, {
    amountInr,
    note,
    screenshotBuffer,
    screenshotContentType,
    screenshotName,
  });
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

  let screenshotPath = '';

  try {
    const uid = await verifyBearerToken(req, auth);
    await assertRcAdmin(db, uid, uid);

    const { fields, files } = await parseMultipart(req);
    const amountInr = Number(fields.amountInr);
    const note = typeof fields.note === 'string' ? fields.note.trim() : '';
    const screenshot = files.screenshot;

    const result = await processWalletTopUpSubmission(db, uid, {
      amountInr,
      note,
      screenshotBuffer: screenshot?.buffer,
      screenshotContentType: screenshot?.mimeType,
      screenshotName: screenshot?.filename,
    });

    res.status(200).json(result);
  } catch (err) {
    await deleteWalletScreenshot(screenshotPath);
    const status =
      err.statusCode
      || (err instanceof HttpsError
        ? err.code === 'already-exists'
          ? 409
          : err.code === 'invalid-argument'
            ? 400
            : err.code === 'unauthenticated'
              ? 401
              : 403
        : 500);
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
  refundRvWalletPaymentHandler,
  linkWalletPaymentToRecordsHandler,
  getWalletApiConfigHandler,
  submitWalletTopUpCallableHandler,
  submitWalletTopUpHttpHandler,
};
