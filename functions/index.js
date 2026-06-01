const { onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const AUTH_EMAIL_DOMAIN = 'yesgatc.auth';
const CALLABLE_REGION = 'us-central1';
/** Firestore database region — must match Eventarc trigger location. */
const FIRESTORE_REGION = 'asia-south1';

function adminAuth() {
  if (!getApps().length) initializeApp();
  return getAuth();
}

function adminDb() {
  if (!getApps().length) initializeApp();
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
