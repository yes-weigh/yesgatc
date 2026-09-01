/**
 * Force ALL VCT accounts to sign out (sets users/{uid}.forceLogoutAt).
 *
 * Requires Firebase Admin credentials:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccount.json
 *   or GOOGLE_APPLICATION_CREDENTIALS
 *   or gcloud application-default credentials
 *
 * Dry run:
 *   node scripts/force-relogin-all-vct.mjs
 *
 * Execute:
 *   node scripts/force-relogin-all-vct.mjs --execute
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const execute = process.argv.includes('--execute');

function initAdmin() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
    || process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path) {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    initializeApp({ credential: cert(json), projectId: json.project_id || 'yesgatc' });
    return;
  }
  initializeApp({ credential: applicationDefault(), projectId: 'yesgatc' });
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const snap = await db.collection('users').where('role', '==', 'vct').get();
  console.log(`VCT accounts found: ${snap.size}`);
  console.log(execute ? 'EXECUTE mode' : 'DRY RUN (pass --execute to apply)');

  for (const doc of snap.docs.slice(0, 30)) {
    const data = doc.data();
    console.log(`  - ${data.username || data.companyName || doc.id} (${doc.id}) rcId=${data.rcId || '—'}`);
  }
  if (snap.size > 30) console.log(`  … +${snap.size - 30} more`);

  if (!execute) {
    console.log('\nDry run only.');
    return;
  }

  let ok = 0;
  let fail = 0;
  const now = FieldValue.serverTimestamp();
  for (const doc of snap.docs) {
    try {
      await doc.ref.update({ forceLogoutAt: now });
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`FAIL ${doc.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
  console.log('All VCT apps listening will sign out and must log in again.');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
