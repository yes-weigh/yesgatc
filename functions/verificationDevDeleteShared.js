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

module.exports = {
  collectRvSubmitBatch,
  isSubmittedRvRecord,
  wipeWalletPaymentForDev,
};
