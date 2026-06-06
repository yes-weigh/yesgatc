const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

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

module.exports = {
  reviewWalletTopUpHandler,
  payRvFromWalletHandler,
};
