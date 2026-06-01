/**
 * Finds and removes orphaned Firebase Auth users and stale aadharIndex entries.
 *
 * Prerequisites:
 *   Download a Firebase service account key (Project settings → Service accounts → Generate key).
 *   Do NOT commit the JSON file.
 *
 * Dry run (default — lists orphans only):
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\path\yesgatc-service-account.json"
 *   npm run cleanup:ghost-auth
 *
 * Execute deletions:
 *   npm run cleanup:ghost-auth -- --execute
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const AUTH_EMAIL_DOMAIN = 'yesgatc.auth';
const execute = process.argv.includes('--execute');

function initAdmin() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    initializeApp({ credential: cert(json) });
    return;
  }
  initializeApp({ credential: applicationDefault() });
}

initAdmin();

const auth = getAuth();
const db = getFirestore();

async function listYesgatcAuthUsers() {
  const users = [];
  let nextPageToken;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    for (const user of page.users) {
      if (user.email?.endsWith(`@${AUTH_EMAIL_DOMAIN}`)) {
        users.push(user);
      }
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return users;
}

async function findGhostAuthUsers() {
  const authUsers = await listYesgatcAuthUsers();
  const ghosts = [];
  for (const user of authUsers) {
    const profile = await db.doc(`users/${user.uid}`).get();
    if (!profile.exists) {
      ghosts.push({ uid: user.uid, email: user.email });
    }
  }
  return ghosts;
}

async function findStaleAadharIndexEntries() {
  const snap = await db.collection('aadharIndex').get();
  const stale = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const uid = typeof data.uid === 'string' ? data.uid : '';
    if (!uid) {
      stale.push({ aadhar: docSnap.id, uid: '(missing)', reason: 'no uid field' });
      continue;
    }
    const profile = await db.doc(`users/${uid}`).get();
    if (!profile.exists) {
      stale.push({ aadhar: docSnap.id, uid, reason: 'users profile missing' });
    }
  }
  return stale;
}

async function main() {
  console.log(execute ? 'EXECUTE mode — orphans will be deleted.\n' : 'DRY RUN — pass --execute to delete.\n');

  const ghosts = await findGhostAuthUsers();
  const staleIndex = await findStaleAadharIndexEntries();

  console.log(`Ghost Auth users (no Firestore profile): ${ghosts.length}`);
  for (const g of ghosts) {
    console.log(`  - ${g.email}  uid=${g.uid}`);
  }

  console.log(`\nStale aadharIndex entries: ${staleIndex.length}`);
  for (const s of staleIndex) {
    console.log(`  - aadharIndex/${s.aadhar}  uid=${s.uid}  (${s.reason})`);
  }

  if (!execute) {
    console.log('\nNo changes made. Re-run with --execute to delete the above.');
    return;
  }

  for (const g of ghosts) {
    try {
      await auth.deleteUser(g.uid);
      console.log(`Deleted Auth: ${g.email}`);
    } catch (err) {
      console.error(`Failed to delete Auth ${g.email}:`, err.message || err);
    }
  }

  for (const s of staleIndex) {
    try {
      await db.doc(`aadharIndex/${s.aadhar}`).delete();
      console.log(`Deleted aadharIndex/${s.aadhar}`);
    } catch (err) {
      console.error(`Failed to delete aadharIndex/${s.aadhar}:`, err.message || err);
    }
  }

  console.log('\nCleanup complete.');
}

main().catch(err => {
  console.error('\nCleanup failed:', err.message || err);
  console.error('\nSet FIREBASE_SERVICE_ACCOUNT_PATH to your service account JSON file.');
  process.exit(1);
});
