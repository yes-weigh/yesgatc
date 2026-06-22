const { HttpsError } = require('firebase-functions/v2/https');
const {
  collectRvSubmitBatch,
  isSubmittedRvRecord,
  wipeWalletPaymentForDev,
} = require('./verificationDevDeleteShared');

function isSubmittedVerificationRecord(record) {
  const type = record?.verificationType;
  return (
    (type === 'RV' || type === 'OV')
    && record?.status === 'submitted'
    && !record?.approvedAt
    && !record?.certifiedAt
    && !String(record?.certificateNumber || '').trim()
  );
}

async function collectSubmittedDeleteBatch(db, anchor, caller) {
  if (anchor.verificationType === 'OV') {
    return [anchor];
  }

  const batch = await collectRvSubmitBatch(db, anchor, caller);
  return batch.filter(isSubmittedRvRecord);
}

/**
 * Dev/testing — Super Admin deletes submitted OV/RV verifications (Admin SDK).
 * Wallet rows restored for RV wallet payments. Zoho cleanup is manual.
 */
async function devDeleteSubmittedVerificationHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const recordId = request.data?.recordId;
  if (!recordId || typeof recordId !== 'string') {
    throw new HttpsError('invalid-argument', 'recordId is required.');
  }

  const callerSnap = await db.doc(`users/${request.auth.uid}`).get();
  if (!callerSnap.exists || callerSnap.data()?.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }

  const anchorSnap = await db.doc(`siteCalibrations/${recordId}`).get();
  if (!anchorSnap.exists) {
    throw new HttpsError('not-found', 'Verification record not found.');
  }

  const anchor = { id: anchorSnap.id, ...anchorSnap.data() };
  if (!isSubmittedVerificationRecord(anchor)) {
    throw new HttpsError(
      'failed-precondition',
      'Only submitted OV/RV verifications without a certificate can be deleted.',
    );
  }

  const batch = await collectSubmittedDeleteBatch(db, anchor, callerSnap.data());
  if (!batch.length) {
    throw new HttpsError('failed-precondition', 'No submitted records found to delete.');
  }

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
    deleted: true,
  };
}

module.exports = {
  devDeleteSubmittedVerificationHandler,
  isSubmittedVerificationRecord,
};
