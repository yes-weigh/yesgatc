const { HttpsError } = require('firebase-functions/v2/https');
const { canPushRvZohoInvoice, processRvZohoInvoice } = require('./zohoRv');
const { processWalletTopUpZohoTransfer } = require('./zohoWallet');

const DEFAULT_RV_BATCH = 25;
const DEFAULT_WALLET_BATCH = 25;

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
  const walletLimit = Number(options.walletLimit) > 0 ? Number(options.walletLimit) : DEFAULT_WALLET_BATCH;

  const summary = {
    rv: { found: 0, sent: 0, failed: 0 },
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
  const walletLimit = request.data?.walletLimit;
  return reconcileOutstandingZoho(db, { rvLimit, walletLimit });
}

async function reconcileZohoOutstandingScheduledHandler(db) {
  return reconcileOutstandingZoho(db);
}

module.exports = {
  reconcileOutstandingZoho,
  reconcileZohoOutstandingHandler,
  reconcileZohoOutstandingScheduledHandler,
  isWalletTopUpZohoOutstanding,
};
