const { onDocumentDeleted, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const emaapOtpWebhookSecret = defineSecret('EMAAP_OTP_WEBHOOK_SECRET');
const yesweighEmbedSecret = defineSecret('YESWEIGH_EMBED_SECRET');
const yesweighEmbedRcAadhar = defineString('YESWEIGH_EMBED_RC_AADHAR', { default: '788971879465' });
const { razorpayWebhookHandler } = require('./razorpayRv');
const {
  createWalletTopUpOrderHandler,
  getWalletTopUpPaymentStatusHandler,
  verifyWalletTopUpPaymentHandler,
} = require('./razorpayWallet');
const {
  zohoClientId,
  zohoClientSecret,
  zohoRefreshToken,
  onSiteCalibrationZohoRvHandler,
  pushLegacyRvZohoInvoiceHandler,
  submitRvWithZohoGateHandler,
  triggerRvZohoInvoiceHandler,
} = require('./zohoRv');
const { pushLegacyWalletTopUpZohoTransferHandler } = require('./zohoWallet');
const {
  reconcileZohoOutstandingHandler,
  reconcileZohoOutstandingScheduledHandler,
} = require('./zohoReconcile');
const {
  moveStaleFailedVerificationsToDraftHandler,
} = require('./verificationStaleToDraft');
const { pushLegacyRvZohoSettlementHandler } = require('./zohoRvSettlement');
const { migrateRcZohoExpenseAccountFieldsHandler } = require('./migrateRcZohoExpenseAccount');
const {
  onSiteCalibrationZohoInvoiceRefHandler,
  pushLegacyRvInvoiceReferenceHandler,
} = require('./zohoRvInvoiceRef');
const { revertRvSubmitTestHandler } = require('./rvSubmitTestRevert');
const { devDeleteSubmittedVerificationHandler } = require('./verificationDevDelete');
const { downloadStorageFileBytesHandler } = require('./docaStorageDownload');
const { emaapOtpWebhookHandler } = require('./emaapOtpInbox');
const { mintYesweighEmbedTokenHandler } = require('./yesweighEmbed');
const { lookupPublicCertificatesHttpHandler } = require('./lookupPublicCertificates');
const { yesoneInboundHttpHandler } = require('./yesoneInbound');
const {
  onSiteCalibrationYesoneWebhookHandler,
  onUserYesoneWebhookHandler,
  testYesoneWebhookHttpHandler,
} = require('./yesoneWebhook');
const {
  reviewWalletTopUpHandler,
  payRvFromWalletHandler,
  refundRvWalletPaymentHandler,
  linkWalletPaymentToRecordsHandler,
  getWalletApiConfigHandler,
  submitWalletTopUpCallableHandler,
  submitWalletTopUpHttpHandler,
  deleteWalletTopUpHandler,
  deleteWalletLedgerEntryHandler,
  resetRcWalletHandler,
  settleOutstandingRvWalletPaymentsHandler,
} = require('./rcWallet');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const AUTH_EMAIL_DOMAIN = 'yesgatc.auth';
const CALLABLE_REGION = 'us-central1';
/** Firestore (default) is nam5 — nearest supported functions region for triggers. */
const FIRESTORE_REGION = 'us-central1';
/** Allow Vite dev server and production hosting to call HTTPS functions. */
const CALLABLE_CORS = [
  /^https:\/\/yesgatc\.in$/,
  /^https:\/\/www\.yesgatc\.in$/,
  /^https:\/\/yesgatc\.web\.app$/,
  /^https:\/\/yesgatc\.firebaseapp\.com$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

if (!getApps().length) {
  initializeApp({ storageBucket: 'yesgatc.firebasestorage.app' });
}

function adminAuth() {
  return getAuth();
}

function adminDb() {
  return getFirestore();
}

async function getCallerRole(uid) {
  const snap = await adminDb().doc(`users/${uid}`).get();
  return snap.exists ? snap.data().role : null;
}

async function callerCanDeleteAuth(callerUid, targetUid) {
  const callerRole = await getCallerRole(callerUid);
  if (!callerRole) return false;

  const targetSnap = await adminDb().doc(`users/${targetUid}`).get();
  if (!targetSnap.exists) {
    return callerRole === 'super_admin' || callerRole === 'rc_admin';
  }

  const target = targetSnap.data();
  if (callerRole === 'super_admin') return true;
  if (callerRole === 'rc_admin' && target.role === 'vct' && target.rcId === callerUid) {
    return true;
  }
  if (callerRole === 'rc_admin' && target.role === 'verifier' && target.rcId === callerUid) {
    return true;
  }
  return false;
}

async function deleteAuthUserSafe(uid) {
  try {
    await adminAuth().deleteUser(uid);
    return { deleted: true };
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return { deleted: false, reason: 'not-found' };
    }
    throw err;
  }
}

/** Creates a Zoho Books invoice when an RV verification is submitted (skips resubmits). */
exports.onSiteCalibrationRvZohoInvoice = onDocumentWritten(
  {
    document: 'siteCalibrations/{recordId}',
    region: FIRESTORE_REGION,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async event => onSiteCalibrationZohoRvHandler(event, adminDb()),
);

/** When certificate number is set, sync Zoho invoice ORDER NUMBER (e.g. 26/1271). */
exports.onSiteCalibrationZohoInvoiceRef = onDocumentWritten(
  {
    document: 'siteCalibrations/{recordId}',
    region: FIRESTORE_REGION,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async event => onSiteCalibrationZohoInvoiceRefHandler(event, adminDb()),
);

/** RV submit gate — Zoho invoice while draft, then mark submitted (wallet already debited). */
exports.submitRvWithZohoGate = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => submitRvWithZohoGateHandler(request, adminDb()),
);

/** RC/VCT invokes after RV submit — backup if the Firestore trigger is delayed or missed. */
exports.triggerRvZohoInvoice = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => triggerRvZohoInvoiceHandler(request, adminDb()),
);

/** Super Admin sets Zoho invoice ORDER NUMBER to applicationNumber on a legacy RV invoice. */
exports.pushLegacyRvInvoiceReference = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => pushLegacyRvInvoiceReferenceHandler(request, adminDb()),
);

/** Super Admin records customer payment + labour expense for a legacy RV Zoho invoice. */
exports.pushLegacyRvZohoSettlement = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => pushLegacyRvZohoSettlementHandler(request, adminDb()),
);

/** Super Admin manually pushes a legacy RV verification to Zoho Books. */
exports.pushLegacyRvZohoInvoice = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => pushLegacyRvZohoInvoiceHandler(request, adminDb()),
);

/** Every 30 minutes — push any RV invoices / wallet transfers still outstanding in Firestore. */
exports.reconcileZohoOutstandingScheduled = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: CALLABLE_REGION,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => reconcileZohoOutstandingScheduledHandler(adminDb()),
);

/** Every 15 minutes — reopen rejected / failed-at-submit drafts after 12 hours. */
exports.moveStaleFailedVerificationsToDraft = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: CALLABLE_REGION,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => moveStaleFailedVerificationsToDraftHandler(adminDb()),
);

/** Super Admin on-demand sweep for unpushed Zoho RV invoices and wallet transfers. */
exports.reconcileZohoOutstanding = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async request => reconcileZohoOutstandingHandler(request, adminDb()),
);

/** Super Admin migrates legacy zohoVendorId fields to zohoExpenseAccountId on RC profiles. */
exports.migrateRcZohoExpenseAccountFields = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => migrateRcZohoExpenseAccountFieldsHandler(request, adminDb()),
);

/** Super Admin manually pushes a legacy wallet top-up credit to Zoho Books. */
exports.pushLegacyWalletTopUpZohoTransfer = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async request => pushLegacyWalletTopUpZohoTransferHandler(request, adminDb()),
);

/** Deletes Firebase Auth when a Firestore user profile is removed (backup if app delete misses Auth). */
exports.onUserProfileDeleted = onDocumentDeleted(
  { document: 'users/{uid}', region: FIRESTORE_REGION },
  async (event) => {
  const uid = event.params.uid;
  const result = await deleteAuthUserSafe(uid);
  if (result.deleted) {
    console.log(`Deleted Auth user ${uid} after Firestore profile removal.`);
  } else {
    console.log(`Auth user ${uid} was already absent after Firestore profile removal.`);
  }
  },
);

/**
 * Deletes a Firebase Auth account (orphan cleanup or explicit admin action).
 * Used when registration fails after Auth was created.
 */
exports.deleteAuthUser = onCall({ region: CALLABLE_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const uid = request.data?.uid;
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'uid is required.');
  }

  const allowed = await callerCanDeleteAuth(request.auth.uid, uid);
  if (!allowed) {
    throw new HttpsError('permission-denied', 'Not allowed to delete this auth account.');
  }

  try {
    return await deleteAuthUserSafe(uid);
  } catch (err) {
    console.error(`deleteAuthUser failed for ${uid}`, err);
    throw new HttpsError('internal', err.message || 'Failed to delete auth user.');
  }
});

/** Super Admin bulk cleanup for Auth accounts with no Firestore profile. */
exports.cleanupGhostAuthUsers = onCall({ region: CALLABLE_REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const callerRole = await getCallerRole(request.auth.uid);
  if (callerRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }

  const dryRun = request.data?.dryRun !== false;
  const ghosts = [];
  let nextPageToken;

  do {
    const page = await adminAuth().listUsers(1000, nextPageToken);
    for (const user of page.users) {
      if (!user.email || !user.email.endsWith(`@${AUTH_EMAIL_DOMAIN}`)) continue;
      const profile = await adminDb().doc(`users/${user.uid}`).get();
      if (!profile.exists) {
        ghosts.push({ uid: user.uid, email: user.email });
        if (!dryRun) {
          await deleteAuthUserSafe(user.uid);
        }
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  return { dryRun, count: ghosts.length, users: ghosts };
});

/**
 * Razorpay webhook — optional. Wallet top-up polling + checkout verify work without it.
 * When you add a webhook in Razorpay Dashboard, copy its secret and run:
 *   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
 * then redeploy this function.
 */
exports.razorpayWebhook = onRequest(
  {
    region: CALLABLE_REGION,
    secrets: [razorpayKeyId, razorpayKeySecret, zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async (req, res) => razorpayWebhookHandler(req, res, adminDb()),
);

/** Creates a Razorpay order for RC wallet recharge (gross = credit + service charge). */
exports.createWalletTopUpOrder = onCall(
  { region: CALLABLE_REGION, secrets: [razorpayKeyId, razorpayKeySecret] },
  async request => createWalletTopUpOrderHandler(request, adminDb()),
);

/** Polls Razorpay for wallet top-up payment completion. */
exports.getWalletTopUpPaymentStatus = onCall(
  {
    region: CALLABLE_REGION,
    secrets: [razorpayKeyId, razorpayKeySecret, zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => getWalletTopUpPaymentStatusHandler(request, adminDb()),
);

/** Verifies Razorpay Checkout signature after wallet top-up payment. */
exports.verifyWalletTopUpPayment = onCall(
  {
    region: CALLABLE_REGION,
    secrets: [razorpayKeyId, razorpayKeySecret, zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => verifyWalletTopUpPaymentHandler(request, adminDb()),
);

/** Super Admin approves or rejects RC wallet top-up requests. */
exports.reviewWalletTopUp = onCall(
  {
    region: CALLABLE_REGION,
    cors: CALLABLE_CORS,
    secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
  },
  async request => reviewWalletTopUpHandler(request, adminDb()),
);

/** Super Admin: debit wallets for RV rows that submitted/certified without payment. */
exports.settleOutstandingRvWalletPayments = onCall(
  { region: CALLABLE_REGION, timeoutSeconds: 300, memory: '512MiB' },
  async request => settleOutstandingRvWalletPaymentsHandler(request, adminDb()),
);

/** RC Admin debits wallet for RV verification payment. */
exports.payRvFromWallet = onCall({ region: CALLABLE_REGION }, async request =>
  payRvFromWalletHandler(request, adminDb()),
);

/** RC Admin refunds a wallet RV payment after failed verification submit. */
exports.refundRvWalletPayment = onCall({ region: CALLABLE_REGION }, async request =>
  refundRvWalletPaymentHandler(request, adminDb()),
);

/** RC Admin links wallet payment ledger rows to created verification records. */
exports.linkWalletPaymentToRecords = onCall({ region: CALLABLE_REGION }, async request =>
  linkWalletPaymentToRecordsHandler(request, adminDb()),
);

/** Returns wallet HTTP endpoint configuration for the signed-in user. */
exports.getWalletApiConfig = onCall({ region: CALLABLE_REGION }, async request =>
  getWalletApiConfigHandler(request),
);

/** RC Admin submits wallet top-up with base64 screenshot (preferred). */
exports.submitWalletTopUpCallable = onCall(
  { region: CALLABLE_REGION, timeoutSeconds: 120, memory: '512MiB' },
  async request => submitWalletTopUpCallableHandler(request, adminDb()),
);

/** RC Admin submits wallet top-up with payment screenshot (server-side Storage upload). */
exports.submitWalletTopUp = onRequest(
  { region: CALLABLE_REGION, cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => submitWalletTopUpHttpHandler(req, res, adminDb(), adminAuth()),
);

/** Super Admin deletes a wallet top-up and reverses balance when approved. */
exports.deleteWalletTopUp = onCall({ region: CALLABLE_REGION }, async request =>
  deleteWalletTopUpHandler(request, adminDb()),
);

/** Super Admin deletes a wallet ledger entry and reverses its balance effect. */
exports.deleteWalletLedgerEntry = onCall({ region: CALLABLE_REGION }, async request =>
  deleteWalletLedgerEntryHandler(request, adminDb()),
);

/** Super Admin wipes all wallet data for an RC and resets balance to zero. */
exports.resetRcWallet = onCall({ region: CALLABLE_REGION }, async request =>
  resetRcWalletHandler(request, adminDb()),
);

/** Dev/testing — delete submitted RV records and restore wallet (Zoho cleared manually). */
exports.revertRvSubmitTest = onCall(
  { region: CALLABLE_REGION, cors: CALLABLE_CORS },
  async request => revertRvSubmitTestHandler(request, adminDb()),
);

/** Dev/testing — Super Admin deletes submitted OV/RV verifications. */
exports.devDeleteSubmittedVerification = onCall(
  { region: CALLABLE_REGION, cors: CALLABLE_CORS },
  async request => devDeleteSubmittedVerificationHandler(request, adminDb()),
);

/** Super Admin downloads a Storage object server-side (avoids bucket CORS in browser). */
exports.downloadStorageFileBytes = onCall(
  { region: CALLABLE_REGION, cors: CALLABLE_CORS, timeoutSeconds: 120, memory: '512MiB' },
  async request => downloadStorageFileBytesHandler(request, getCallerRole),
);

/**
 * eMAAP login OTP inbox — POST forwarded mail / Apps Script JSON → Firestore emaapOtpInbox.
 * Set secret: firebase functions:secrets:set EMAAP_OTP_WEBHOOK_SECRET
 */
exports.emaapOtpWebhook = onRequest(
  {
    region: CALLABLE_REGION,
    cors: true,
    secrets: [emaapOtpWebhookSecret],
  },
  async (req, res) => emaapOtpWebhookHandler(req, res, adminDb(), emaapOtpWebhookSecret.value()),
);

/**
 * Public certificate download page — serial or certificate number → safe PDF fields only.
 * HTTP + public invoker so unauthenticated browsers can preflight from yesgatc.in.
 */
exports.lookupPublicCertificates = onRequest(
  {
    region: CALLABLE_REGION,
    cors: true,
    invoker: 'public',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => lookupPublicCertificatesHttpHandler(req, res, adminDb()),
);

/** Outbound yesone webhook — POST verification + certificate payloads on every siteCalibration write. */
exports.onSiteCalibrationYesoneWebhook = onDocumentWritten(
  {
    document: 'siteCalibrations/{recordId}',
    region: FIRESTORE_REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async event => onSiteCalibrationYesoneWebhookHandler(event, adminDb()),
);

/** Outbound yesone webhook — RC created / deactivated / modified. */
exports.onUserYesoneWebhook = onDocumentWritten(
  {
    document: 'users/{userId}',
    region: FIRESTORE_REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async event => onUserYesoneWebhookHandler(event, adminDb()),
);

/**
 * Super Admin: push all RC + issued certificate payloads to yesone and return a log.
 * HTTP + public invoker so localhost CORS preflight is not blocked by Cloud Run IAM.
 */
exports.testYesoneWebhook = onRequest(
  {
    region: CALLABLE_REGION,
    cors: true,
    invoker: 'public',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (req, res) => testYesoneWebhookHttpHandler(req, res, adminDb(), adminAuth()),
);

/**
 * YesWeigh Service iframe — mint a custom token for the configured RC account.
 * Shared secret must match yesweigh-service YESWEIGH_EMBED_SECRET.
 * Set before deploy: firebase functions:secrets:set YESWEIGH_EMBED_SECRET --project yesgatc
 */
exports.mintYesweighEmbedToken = onRequest(
  {
    region: CALLABLE_REGION,
    cors: true,
    invoker: 'public',
    secrets: [yesweighEmbedSecret],
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) =>
    mintYesweighEmbedTokenHandler(
      req,
      res,
      yesweighEmbedSecret.value(),
      yesweighEmbedRcAadhar.value(),
    ),
);

/**
 * Inbound yesone webhook — POST serial allotment, RC OV quota, serial updates.
 * Public invoker so yesone can POST without Firebase Auth. Token query/header required.
 */
exports.yesoneInbound = onRequest(
  {
    region: CALLABLE_REGION,
    cors: true,
    invoker: 'public',
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (req, res) => {
    try {
      await yesoneInboundHttpHandler(req, res, adminDb());
    } catch (err) {
      console.error('yesoneInbound', err);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: 'internal_error',
          message: err instanceof Error ? err.message : 'inbound_failed',
        });
      }
    }
  },
);
