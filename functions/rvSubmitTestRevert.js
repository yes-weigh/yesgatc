const { HttpsError } = require('firebase-functions/v2/https');

function ledgerRef(db, ledgerId) {
  return db.doc(`walletLedger/${ledgerId}`);
}

function walletRef(db, rcId) {
  return db.doc(`rcWallets/${rcId}`);
}

function roundInr(value) {
  return Math.round(value * 100) / 100;
}

function ledgerIdFromPaymentId(paymentId) {
  if (typeof paymentId !== 'string' || !paymentId.startsWith('wallet:')) {
    return null;
  }
  const ledgerId = paymentId.slice('wallet:'.length).trim();
  return ledgerId || null;
}

function isSubmittedRvRecord(record) {
  return (
    record?.verificationType === 'RV'
    && record?.status === 'submitted'
    && !record?.approvedAt
    && !record?.certifiedAt
    && !String(record?.certificateNumber || '').trim()
  );
}

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

async function collectRvSubmitBatch(db, anchor, caller) {
  if (isDevWipeableCertifiedRv(anchor, caller)) {
    return [{ id: anchor.id, ...anchor }];
  }

  const paymentId = anchor.rvPaymentId;
  const ledgerId = ledgerIdFromPaymentId(paymentId);
  if (ledgerId) {
    const ledgerSnap = await ledgerRef(db, ledgerId).get();
    const recordIds = Array.isArray(ledgerSnap.data()?.recordIds)
      ? ledgerSnap.data().recordIds.filter(id => typeof id === 'string' && id.trim())
      : [];
    if (recordIds.length) {
      const snaps = await Promise.all(
        recordIds.map(id => db.doc(`siteCalibrations/${id}`).get()),
      );
      const records = snaps
        .filter(snap => snap.exists)
        .map(snap => ({ id: snap.id, ...snap.data() }))
        .filter(isSubmittedRvRecord);
      if (records.length) return records;
    }
  }

  const submittedAt = anchor.submittedAt;
  const rcId = anchor.rcId;
  if (submittedAt && rcId) {
    const snap = await db
      .collection('siteCalibrations')
      .where('rcId', '==', rcId)
      .where('submittedAt', '==', submittedAt)
      .where('verificationType', '==', 'RV')
      .where('status', '==', 'submitted')
      .get();
    const records = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    if (records.length) return records;
  }

  return [{ id: anchor.id || anchor.recordId, ...anchor }];
}

async function wipeWalletPaymentForDev(db, transaction, paymentId) {
  const ledgerId = ledgerIdFromPaymentId(paymentId);
  if (!ledgerId) {
    return { walletAdjusted: false, deletedLedgerIds: [] };
  }

  const paymentLedgerRef = ledgerRef(db, ledgerId);
  const refundLedgerRef = ledgerRef(db, `${ledgerId}-refund`);
  const paymentSnap = await transaction.get(paymentLedgerRef);
  if (!paymentSnap.exists) {
    return { walletAdjusted: false, deletedLedgerIds: [] };
  }

  const paymentLedger = paymentSnap.data();
  const refundSnap = await transaction.get(refundLedgerRef);
  const rcId = paymentLedger.rcId;
  if (!rcId) {
    throw new HttpsError('failed-precondition', 'Wallet ledger entry is missing RC scope.');
  }

  const walletSnap = await transaction.get(walletRef(db, rcId));
  let balance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;
  let walletAdjusted = false;

  if (paymentLedger.type === 'rv_payment' && paymentLedger.status !== 'refunded') {
    balance = roundInr(balance + Math.abs(Number(paymentLedger.amountInr) || 0));
    walletAdjusted = true;
  }

  transaction.set(
    walletRef(db, rcId),
    {
      rcId,
      balanceInr: balance,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  const deletedLedgerIds = [ledgerId];
  transaction.delete(paymentLedgerRef);
  if (refundSnap.exists) {
    transaction.delete(refundLedgerRef);
    deletedLedgerIds.push(`${ledgerId}-refund`);
  }

  return { walletAdjusted, deletedLedgerIds, balanceInr: balance, rcId };
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
