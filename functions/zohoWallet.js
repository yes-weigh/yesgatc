const { HttpsError } = require('firebase-functions/v2/https');
const { zohoBooksRequest } = require('./zohoRv');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';

const DEFAULT_ZOHO_WALLET_SETTINGS = {
  zohoWalletTransferEnabled: true,
  zohoWalletFromAccountId: '99381000000006234',
  zohoWalletToAccountId: '99381000030412002',
};

function normalizeZohoNumericId(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeZohoWalletSettings(data) {
  const source = data && typeof data === 'object' ? data : {};
  const orgId =
    normalizeZohoNumericId(source.zohoOrganizationId) || '60001225303';
  return {
    zohoOrganizationId: orgId,
    zohoWalletTransferEnabled: source.zohoWalletTransferEnabled !== false,
    zohoWalletFromAccountId:
      normalizeZohoNumericId(source.zohoWalletFromAccountId)
      || DEFAULT_ZOHO_WALLET_SETTINGS.zohoWalletFromAccountId,
    zohoWalletToAccountId:
      normalizeZohoNumericId(source.zohoWalletToAccountId)
      || DEFAULT_ZOHO_WALLET_SETTINGS.zohoWalletToAccountId,
  };
}

async function loadZohoWalletSettings(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  return normalizeZohoWalletSettings(snap.exists ? snap.data() : undefined);
}

function walletTopUpReference(topUpId) {
  const safe = String(topUpId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  return `WALLET-${safe || 'TOPUP'}`;
}

function buildWalletTopUpDescription(rcName, note, { legacy = false } = {}) {
  const parts = [
    legacy ? 'GATC wallet top-up approved (legacy push)' : 'GATC wallet top-up approved',
    `RC: ${rcName}`,
  ];
  const trimmedNote = String(note || '').trim();
  if (trimmedNote) parts.push(trimmedNote);
  return parts.join(' · ').slice(0, 500);
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function createWalletTopUpFundTransfer({
  topUpId,
  amountInr,
  rcName,
  note,
  reviewedAt,
  settings,
  legacy = false,
}) {
  const amount = Number(amountInr);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid wallet top-up amount for Zoho transfer.');
  }

  const fromAccountId = settings.zohoWalletFromAccountId;
  const toAccountId = settings.zohoWalletToAccountId;
  if (fromAccountId.length < 10 || toAccountId.length < 10) {
    throw new Error('Zoho wallet transfer bank account IDs are not configured.');
  }

  const body = {
    transaction_type: 'transfer_fund',
    from_account_id: fromAccountId,
    to_account_id: toAccountId,
    amount,
    date: String(reviewedAt || new Date().toISOString()).slice(0, 10),
    description: buildWalletTopUpDescription(rcName, note, { legacy }),
    reference_number: walletTopUpReference(topUpId),
    exchange_rate: 1,
  };

  const created = await zohoBooksRequest(
    `/banktransactions?organization_id=${settings.zohoOrganizationId}`,
    { method: 'POST', body, logLabel: 'wallet-topup-transfer' },
  );

  const txn = created.banktransaction;
  if (!txn?.transaction_id) {
    throw new Error('Zoho transfer response did not include transaction_id.');
  }

  return {
    zohoTransactionId: String(txn.transaction_id),
    zohoFromAccountName: txn.from_account_name ? String(txn.from_account_name) : undefined,
    zohoToAccountName: txn.to_account_name ? String(txn.to_account_name) : undefined,
    zohoReferenceNumber: body.reference_number,
    zohoTransferDescription: body.description,
  };
}

async function writeTopUpZohoTransferResult(db, topUpId, patch) {
  await db.doc(`walletTopUps/${topUpId}`).set(
    {
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * After Super Admin approves a wallet top-up, record Kotak → GATC Wallet transfer in Zoho Books.
 * Failures are stored on the top-up doc; wallet approval is not rolled back.
 */
async function processWalletTopUpZohoTransfer(db, topUpId, topUp, { allowLegacyPush = false } = {}) {
  if (topUp.zohoTransferStatus === 'completed' && topUp.zohoTransactionId) {
    if (allowLegacyPush) {
      throw new HttpsError('failed-precondition', 'This top-up already has a Zoho transfer.');
    }
    console.log(`Zoho wallet transfer already completed for top-up ${topUpId}`);
    return null;
  }

  if (topUp.status !== 'approved') {
    const message = 'Only approved wallet top-ups can be transferred in Zoho.';
    if (allowLegacyPush) {
      throw new HttpsError('failed-precondition', message);
    }
    console.log(`Zoho wallet transfer skipped for non-approved top-up ${topUpId}`);
    return null;
  }

  const settings = await loadZohoWalletSettings(db);
  if (!settings.zohoWalletTransferEnabled && !allowLegacyPush) {
    console.log(`Zoho wallet transfer disabled — skip top-up ${topUpId}`);
    return null;
  }

  let rcName = String(topUp.rcCompanyName || '').trim();
  if (!rcName && topUp.rcId) {
    const rcSnap = await db.doc(`users/${topUp.rcId}`).get();
    if (rcSnap.exists) {
      const rc = rcSnap.data();
      rcName = String(rc.companyName || rc.username || '').trim();
    }
  }
  if (!rcName) rcName = String(topUp.rcId || 'RC');

  const reviewedAt = topUp.reviewedAt || new Date().toISOString();
  const pushedAt = new Date().toISOString();

  try {
    const result = await createWalletTopUpFundTransfer({
      topUpId,
      amountInr: topUp.amountInr,
      rcName,
      note: topUp.note,
      reviewedAt,
      settings,
      legacy: allowLegacyPush,
    });

    await writeTopUpZohoTransferResult(db, topUpId, {
      ...result,
      zohoTransferStatus: 'completed',
      zohoTransferError: null,
      zohoTransferredAt: pushedAt,
    });

    console.log(
      `Zoho wallet transfer for top-up ${topUpId}: ${result.zohoTransactionId} (${rcName}, ₹${topUp.amountInr})`,
    );
    return { topUpId, zohoTransferStatus: 'completed', ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Zoho wallet transfer failed.';
    console.error(`Zoho wallet transfer failed for top-up ${topUpId}`, err);
    await writeTopUpZohoTransferResult(db, topUpId, {
      zohoTransferStatus: 'failed',
      zohoTransferError: message.slice(0, 500),
      zohoTransferredAt: pushedAt,
    });
    if (allowLegacyPush) {
      throw new HttpsError('internal', message);
    }
    return null;
  }
}

async function pushLegacyWalletTopUpZohoTransferHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  await assertSuperAdmin(db, request.auth.uid);

  const topUpId = request.data?.topUpId;
  if (!topUpId || typeof topUpId !== 'string') {
    throw new HttpsError('invalid-argument', 'topUpId is required.');
  }

  const snap = await db.doc(`walletTopUps/${topUpId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Wallet top-up not found.');
  }

  const topUp = snap.data();
  const settings = await loadZohoWalletSettings(db);
  if (
    settings.zohoWalletFromAccountId.length < 10
    || settings.zohoWalletToAccountId.length < 10
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Configure Kotak and GATC Wallet account IDs in Admin Zoho settings.',
    );
  }

  const result = await processWalletTopUpZohoTransfer(db, topUpId, topUp, {
    allowLegacyPush: true,
  });
  if (!result) {
    throw new HttpsError('internal', 'Zoho wallet transfer did not complete.');
  }
  return result;
}

module.exports = {
  processWalletTopUpZohoTransfer,
  pushLegacyWalletTopUpZohoTransferHandler,
  normalizeZohoWalletSettings,
  walletTopUpReference,
  buildWalletTopUpDescription,
};
