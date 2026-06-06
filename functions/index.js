const { onDocumentDeleted, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');

const razorpayKeyId = defineSecret('RAZORPAY_KEY_ID');
const razorpayKeySecret = defineSecret('RAZORPAY_KEY_SECRET');
const {
  createRvPaymentOrderHandler,
  getRvPaymentStatusHandler,
  verifyRvPaymentHandler,
  razorpayWebhookHandler,
} = require('./razorpayRv');
const {
  zohoClientId,
  zohoClientSecret,
  zohoRefreshToken,
  onSiteCalibrationZohoRvHandler,
  pushLegacyRvZohoInvoiceHandler,
  triggerRvZohoInvoiceHandler,
} = require('./zohoRv');
const { pushLegacyWalletTopUpZohoTransferHandler } = require('./zohoWallet');
const {
  reconcileZohoOutstandingHandler,
  reconcileZohoOutstandingScheduledHandler,
} = require('./zohoReconcile');
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

/** Creates a Razorpay order + dynamic UPI QR for RV administrative fees + GST. */
exports.createRvPaymentOrder = onCall(
  { region: CALLABLE_REGION, secrets: [razorpayKeyId, razorpayKeySecret] },
  async (request) => createRvPaymentOrderHandler(request, adminDb()),
);

/** Polls Razorpay / Firestore for RV payment completion (QR scan or checkout). */
exports.getRvPaymentStatus = onCall(
  { region: CALLABLE_REGION, secrets: [razorpayKeyId, razorpayKeySecret] },
  async (request) => getRvPaymentStatusHandler(request, adminDb()),
);

/** Verifies Razorpay Checkout signature after UPI payment on the same device. */
exports.verifyRvPayment = onCall(
  { region: CALLABLE_REGION, secrets: [razorpayKeyId, razorpayKeySecret] },
  async (request) => verifyRvPaymentHandler(request, adminDb()),
);

/**
 * Razorpay webhook — optional. Polling + checkout verify work without it.
 * When you add a webhook in Razorpay Dashboard, copy its secret and run:
 *   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
 * then redeploy this function.
 */
exports.razorpayWebhook = onRequest(
  { region: CALLABLE_REGION, secrets: [razorpayKeyId, razorpayKeySecret] },
  async (req, res) => razorpayWebhookHandler(req, res, adminDb()),
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
