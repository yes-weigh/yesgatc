const { HttpsError } = require('firebase-functions/v2/https');
const { canPushRvZohoInvoice, processRvZohoInvoice } = require('./zohoRv');
const { canSettleRvZoho, processRvZohoSettlement } = require('./zohoRvSettlement');
const { processWalletTopUpZohoTransfer } = require('./zohoWallet');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';

const DEFAULT_RV_BATCH = 25;
const DEFAULT_RV_SETTLEMENT_BATCH = 25;
const DEFAULT_WALLET_BATCH = 25;

async function isZohoReconcileScheduledEnabled(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  if (!snap.exists) return true;
  return snap.data().zohoReconcileEnabled !== false;
}

function isWalletTopUpZohoOutstanding(record) {
  if (!record || record.status !== 'approved') return false;
  if (record.zohoTransferStatus === 'completed' && record.zohoTransactionId) {
    return false;
  }
  return true;
}

async function collectOutstandingRvInvoices(db, limit) {
  const seen = new Set();
  const outstanding = [];

  const tryAdd = (id, data) => {
    if (seen.has(id) || !canPushRvZohoInvoice(data)) return;
    seen.add(id);
    outstanding.push({ id, data });
  };

  for (const status of ['submitted', 'approved', 'certified']) {
    if (outstanding.length >= limit) break;
    const snap = await db
      .collection('siteCalibrations')
      .where('verificationType', '==', 'RV')
      .where('status', '==', status)
      .limit(150)
      .get();
    for (const doc of snap.docs) {
      if (outstanding.length >= limit) break;
      tryAdd(doc.id, doc.data());
    }
  }

  if (outstanding.length < limit) {
    const failedSnap = await db
      .collection('siteCalibrations')
      .where('verificationType', '==', 'RV')
      .where('zohoPushStatus', '==', 'failed')
      .limit(100)
      .get();
    for (const doc of failedSnap.docs) {
      if (outstanding.length >= limit) break;
      tryAdd(doc.id, doc.data());
    }
  }

  return outstanding.slice(0, limit);
}

async function collectOutstandingRvSettlements(db, limit) {
  const seen = new Set();
  const outstanding = [];

  const tryAdd = (id, data) => {
    if (seen.has(id) || !canSettleRvZoho(data)) return;
    seen.add(id);
    outstanding.push({ id, data });
  };

  for (const status of ['submitted', 'approved', 'certified']) {
    if (outstanding.length >= limit) break;
    const snap = await db
      .collection('siteCalibrations')
      .where('verificationType', '==', 'RV')
      .where('status', '==', status)
      .limit(200)
      .get();
    for (const doc of snap.docs) {
      if (outstanding.length >= limit) break;
      tryAdd(doc.id, doc.data());
    }
  }

  if (outstanding.length < limit) {
    const failedSnap = await db
      .collection('siteCalibrations')
      .where('verificationType', '==', 'RV')
      .where('zohoSettlementStatus', '==', 'failed')
      .limit(100)
      .get();
    for (const doc of failedSnap.docs) {
      if (outstanding.length >= limit) break;
      tryAdd(doc.id, doc.data());
    }
  }

  return outstanding.slice(0, limit);
}

async function collectOutstandingWalletTransfers(db, limit) {
  const snap = await db
    .collection('walletTopUps')
    .where('status', '==', 'approved')
    .limit(200)
    .get();

  const outstanding = [];
  for (const doc of snap.docs) {
    if (outstanding.length >= limit) break;
    if (isWalletTopUpZohoOutstanding(doc.data())) {
      outstanding.push({ id: doc.id, data: doc.data() });
    }
  }
  return outstanding;
}

/**
 * Push any RV invoices and wallet top-up transfers that are still outstanding in Firestore.
 * Safe to run repeatedly — skips records already sent/completed in Zoho.
 */
async function reconcileOutstandingZoho(db, options = {}) {
  const rvLimit = Number(options.rvLimit) > 0 ? Number(options.rvLimit) : DEFAULT_RV_BATCH;
  const rvSettlementLimit = Number(options.rvSettlementLimit) > 0
    ? Number(options.rvSettlementLimit)
    : DEFAULT_RV_SETTLEMENT_BATCH;
  const walletLimit = Number(options.walletLimit) > 0 ? Number(options.walletLimit) : DEFAULT_WALLET_BATCH;

  const summary = {
    rv: { found: 0, sent: 0, failed: 0 },
    rvSettlement: { found: 0, sent: 0, failed: 0 },
    wallet: { found: 0, sent: 0, failed: 0 },
  };

  const rvTargets = await collectOutstandingRvInvoices(db, rvLimit);
  summary.rv.found = rvTargets.length;

  for (const { id, data } of rvTargets) {
    try {
      const result = await processRvZohoInvoice(db, id, data);
      if (result?.zohoPushStatus === 'sent') {
        summary.rv.sent += 1;
      } else {
        summary.rv.failed += 1;
      }
    } catch (err) {
      console.error(`Zoho reconcile RV failed for ${id}`, err);
      summary.rv.failed += 1;
    }
  }

  const rvSettlementTargets = await collectOutstandingRvSettlements(db, rvSettlementLimit);
  summary.rvSettlement.found = rvSettlementTargets.length;

  for (const { id, data } of rvSettlementTargets) {
    try {
      const result = await processRvZohoSettlement(db, id, data);
      if (result?.zohoSettlementStatus === 'completed') {
        summary.rvSettlement.sent += 1;
      } else {
        summary.rvSettlement.failed += 1;
      }
    } catch (err) {
      console.error(`Zoho reconcile RV settlement failed for ${id}`, err);
      summary.rvSettlement.failed += 1;
    }
  }

  const walletTargets = await collectOutstandingWalletTransfers(db, walletLimit);
  summary.wallet.found = walletTargets.length;

  for (const { id, data } of walletTargets) {
    try {
      const result = await processWalletTopUpZohoTransfer(db, id, data);
      if (result?.zohoTransferStatus === 'completed') {
        summary.wallet.sent += 1;
      } else {
        summary.wallet.failed += 1;
      }
    } catch (err) {
      console.error(`Zoho reconcile wallet failed for ${id}`, err);
      summary.wallet.failed += 1;
    }
  }

  console.log('Zoho reconcile complete', summary);
  return summary;
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function reconcileZohoOutstandingHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  await assertSuperAdmin(db, request.auth.uid);

  const rvLimit = request.data?.rvLimit;
  const rvSettlementLimit = request.data?.rvSettlementLimit;
  const walletLimit = request.data?.walletLimit;
  return reconcileOutstandingZoho(db, { rvLimit, rvSettlementLimit, walletLimit });
}

async function reconcileZohoOutstandingScheduledHandler(db) {
  if (!(await isZohoReconcileScheduledEnabled(db))) {
    console.log('Zoho reconcile scheduled run skipped — disabled in Admin Zoho settings.');
    return { skipped: true, reason: 'zohoReconcileEnabled is false' };
  }
  return reconcileOutstandingZoho(db);
}

module.exports = {
  reconcileOutstandingZoho,
  reconcileZohoOutstandingHandler,
  reconcileZohoOutstandingScheduledHandler,
  isWalletTopUpZohoOutstanding,
  collectOutstandingRvSettlements,
};
