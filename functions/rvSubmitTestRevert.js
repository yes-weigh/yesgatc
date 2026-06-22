const { HttpsError } = require('firebase-functions/v2/https');
const {
  collectRvSubmitBatch,
  isSubmittedRvRecord,
  wipeWalletPaymentForDev,
} = require('./verificationDevDeleteShared');

function isDevWipeableCertifiedRv(record, caller) {
  return (
    caller?.role === 'super_admin'
    && record?.verificationType === 'RV'
    && (record?.status === 'certified' || record?.status === 'approved')
  );
}

function canDevRevertRvRecord(record, caller) {
  return isSubmittedRvRecord(record) || isDevWipeableCertifiedRv(record, caller);
}

async function assertRvTestRevertAccess(db, uid, records) {
  const callerSnap = await db.doc(`users/${uid}`).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }

  const caller = callerSnap.data();
  if (caller.role === 'super_admin') return caller;

  for (const record of records) {
    const rcId = record.rcId;
    if (!rcId) {
      throw new HttpsError('failed-precondition', 'Record is missing RC scope.');
    }
    if (caller.role === 'rc_admin') {
      if (uid !== rcId) {
        throw new HttpsError('permission-denied', 'Cannot revert another RC verification.');
      }
      continue;
    }
    if (caller.role === 'vct') {
      if (caller.rcId !== rcId) {
        throw new HttpsError('permission-denied', 'Cannot revert another RC verification.');
      }
      continue;
    }
    throw new HttpsError('permission-denied', 'Super Admin, RC Admin, or VCT required.');
  }

  return caller;
}

/**
 * Dev/testing helper — delete submitted RV records, restore wallet, wipe ledger rows.
 * Zoho invoice/settlement must be removed manually (instructions shown in UI).
 */
async function revertRvSubmitTestHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const recordId = request.data?.recordId;
  if (!recordId || typeof recordId !== 'string') {
    throw new HttpsError('invalid-argument', 'recordId is required.');
  }

  const anchorSnap = await db.doc(`siteCalibrations/${recordId}`).get();
  if (!anchorSnap.exists) {
    throw new HttpsError('not-found', 'Verification record not found.');
  }

  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  const caller = callerSnap.exists ? callerSnap.data() : null;

  const anchor = { id: anchorSnap.id, ...anchorSnap.data() };
  if (!canDevRevertRvRecord(anchor, caller)) {
    throw new HttpsError(
      'failed-precondition',
      'Only submitted RV verifications, or certified/approved RV (Super Admin, dev) can be reverted.',
    );
  }

  const batch = await collectRvSubmitBatch(db, anchor, caller);
  if (!batch.length) {
    throw new HttpsError('failed-precondition', 'No submitted RV records found to revert.');
  }

  await assertRvTestRevertAccess(db, request.auth.uid, batch);

  const paymentIds = [...new Set(
    batch
      .map(record => record.rvPaymentId)
      .filter(id => typeof id === 'string' && id.startsWith('wallet:')),
  )];

  const result = await db.runTransaction(async transaction => {
    const walletResults = [];
    for (const paymentId of paymentIds) {
      walletResults.push(await wipeWalletPaymentForDev(db, transaction, paymentId));
    }

    for (const record of batch) {
      transaction.delete(db.doc(`siteCalibrations/${record.id}`));
    }

    return {
      deletedRecordIds: batch.map(record => record.id),
      walletResults,
    };
  });

  return {
    recordId,
    deletedRecordIds: result.deletedRecordIds,
    deletedCount: result.deletedRecordIds.length,
    walletPaymentsCleared: paymentIds.length,
    walletResults: result.walletResults,
    reverted: true,
  };
}

module.exports = {
  revertRvSubmitTestHandler,
  isSubmittedRvRecord,
  canDevRevertRvRecord,
};
