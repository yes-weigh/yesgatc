/**
 * Backfill laboratory seal ID → IND/GATC/KL/26/04/C26
 *
 * Updates:
 *   1) siteCalibrations where status == submitted → sealIdentificationNumber
 *   2) users RC / super_admin (or any doc with laboratorySealIdentification) → new seal
 *
 * Does NOT touch approved / certified / draft / other non-submitted verifications.
 *
 * Dry run (default):
 *   npm run backfill:seal-id
 *
 * Apply:
 *   npm run backfill:seal-id -- --execute
 *
 * Auth: FIREBASE_SERVICE_ACCOUNT_PATH, or gcloud user access token (Firestore REST).
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const execute = process.argv.includes('--execute');
const NEW_SEAL = 'IND/GATC/KL/26/04/C26';
const PROJECT_ID = process.env.GCLOUD_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || 'yesgatc';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function gcloudAccessToken() {
  try {
    return execFileSync('gcloud.cmd', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      shell: true,
    }).trim();
  } catch {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      shell: true,
    }).trim();
  }
}

function tryInitAdminSdk() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path && existsSync(path)) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(path, 'utf8'))), projectId: PROJECT_ID });
    console.log(`Auth: service account (${path})`);
    return getFirestore();
  }
  const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (adc && existsSync(adc)) {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('Auth: GOOGLE_APPLICATION_CREDENTIALS');
    return getFirestore();
  }
  return null;
}

function decodeFirestoreValue(v) {
  if (v == null) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    for (const [k, child] of Object.entries(v.mapValue.fields || {})) {
      out[k] = decodeFirestoreValue(child);
    }
    return out;
  }
  return undefined;
}

function docIdFromName(name) {
  return String(name).split('/').pop();
}

async function restJson(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

async function runViaRest(token) {
  console.log('Auth: gcloud user access token (Firestore REST)');

  // Query submitted siteCalibrations
  const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const submittedRows = await restJson('POST', runQueryUrl, token, {
    structuredQuery: {
      from: [{ collectionId: 'siteCalibrations' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'submitted' },
        },
      },
    },
  });

  const submittedWrites = [];
  let submittedSkipSame = 0;
  for (const row of submittedRows) {
    if (!row.document) continue;
    const fields = row.document.fields || {};
    const current = String(decodeFirestoreValue(fields.sealIdentificationNumber) ?? '').trim();
    const id = docIdFromName(row.document.name);
    if (current === NEW_SEAL) {
      submittedSkipSame += 1;
      continue;
    }
    submittedWrites.push({ id, from: current || '(empty)', name: row.document.name });
  }

  console.log(`Submitted verifications: ${submittedWrites.length + submittedSkipSame} found`);
  console.log(`  would update: ${submittedWrites.length}`);
  console.log(`  already ${NEW_SEAL}: ${submittedSkipSame}`);
  for (const w of submittedWrites.slice(0, 15)) {
    console.log(`    ${w.id}: ${w.from} → ${NEW_SEAL}`);
  }
  if (submittedWrites.length > 15) {
    console.log(`    … +${submittedWrites.length - 15} more`);
  }

  // List all users (paginated)
  const userWrites = [];
  let usersSkipSame = 0;
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const page = await restJson('GET', `${BASE}/users?${qs}`, token);
    for (const doc of page.documents || []) {
      const fields = doc.fields || {};
      const role = String(decodeFirestoreValue(fields.role) ?? '');
      const hasField = Object.prototype.hasOwnProperty.call(fields, 'laboratorySealIdentification');
      const isRcish =
        role === 'rc' ||
        role === 'rc_admin' ||
        role === 'super_admin';
      if (!hasField && !isRcish) continue;

      const current = String(decodeFirestoreValue(fields.laboratorySealIdentification) ?? '').trim();
      const id = docIdFromName(doc.name);
      if (current === NEW_SEAL) {
        usersSkipSame += 1;
        continue;
      }
      userWrites.push({
        id,
        role: role || '?',
        from: hasField ? (current || '(empty)') : '(missing)',
        name: doc.name,
      });
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  console.log(`\nUser lab configs (RC / super_admin / existing field):`);
  console.log(`  would update: ${userWrites.length}`);
  console.log(`  already ${NEW_SEAL}: ${usersSkipSame}`);
  for (const w of userWrites.slice(0, 20)) {
    console.log(`    ${w.id} [${w.role}]: ${w.from} → ${NEW_SEAL}`);
  }
  if (userWrites.length > 20) {
    console.log(`    … +${userWrites.length - 20} more`);
  }

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to apply.');
    return;
  }

  const commitUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
  const all = [
    ...submittedWrites.map((w) => ({
      update: {
        name: w.name,
        fields: {
          sealIdentificationNumber: { stringValue: NEW_SEAL },
        },
      },
      updateMask: { fieldPaths: ['sealIdentificationNumber'] },
      currentDocument: { exists: true },
    })),
    ...userWrites.map((w) => ({
      update: {
        name: w.name,
        fields: {
          laboratorySealIdentification: { stringValue: NEW_SEAL },
        },
      },
      updateMask: { fieldPaths: ['laboratorySealIdentification'] },
      currentDocument: { exists: true },
    })),
  ];

  const CHUNK = 200;
  for (let i = 0; i < all.length; i += CHUNK) {
    await restJson('POST', commitUrl, token, { writes: all.slice(i, i + CHUNK) });
    console.log(`Committed ${Math.min(i + CHUNK, all.length)} / ${all.length}`);
  }

  console.log(
    `\nDone. Updated ${submittedWrites.length} submitted verification(s) and ${userWrites.length} user config(s).`,
  );
}

async function runViaAdmin(db) {
  console.log(
    execute
      ? `EXECUTE — seal → ${NEW_SEAL} (project ${PROJECT_ID})\n`
      : `DRY RUN — pass --execute to write (project ${PROJECT_ID})\n`,
  );

  const submittedSnap = await db
    .collection('siteCalibrations')
    .where('status', '==', 'submitted')
    .get();

  const submittedWrites = [];
  let submittedSkipSame = 0;
  for (const docSnap of submittedSnap.docs) {
    const current = String(docSnap.data()?.sealIdentificationNumber ?? '').trim();
    if (current === NEW_SEAL) {
      submittedSkipSame += 1;
      continue;
    }
    submittedWrites.push({
      ref: docSnap.ref,
      data: { sealIdentificationNumber: NEW_SEAL },
      id: docSnap.id,
      from: current || '(empty)',
    });
  }

  console.log(`Submitted verifications: ${submittedSnap.size} found`);
  console.log(`  would update: ${submittedWrites.length}`);
  console.log(`  already ${NEW_SEAL}: ${submittedSkipSame}`);
  for (const w of submittedWrites.slice(0, 15)) {
    console.log(`    ${w.id}: ${w.from} → ${NEW_SEAL}`);
  }

  const usersSnap = await db.collection('users').get();
  const userWrites = [];
  let usersSkipSame = 0;
  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data() || {};
    const hasField = Object.prototype.hasOwnProperty.call(data, 'laboratorySealIdentification');
    const isRcish =
      data.role === 'rc' ||
      data.role === 'rc_admin' ||
      data.role === 'super_admin';
    if (!hasField && !isRcish) continue;
    const current = String(data.laboratorySealIdentification ?? '').trim();
    if (current === NEW_SEAL) {
      usersSkipSame += 1;
      continue;
    }
    userWrites.push({
      ref: docSnap.ref,
      data: { laboratorySealIdentification: NEW_SEAL },
      id: docSnap.id,
      role: data.role ?? '?',
      from: hasField ? (current || '(empty)') : '(missing)',
    });
  }

  console.log(`\nUser lab configs:`);
  console.log(`  would update: ${userWrites.length}`);
  console.log(`  already ${NEW_SEAL}: ${usersSkipSame}`);
  for (const w of userWrites.slice(0, 20)) {
    console.log(`    ${w.id} [${w.role}]: ${w.from} → ${NEW_SEAL}`);
  }

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to apply.');
    return;
  }

  const CHUNK = 400;
  for (const list of [submittedWrites, userWrites]) {
    for (let i = 0; i < list.length; i += CHUNK) {
      const batch = db.batch();
      for (const w of list.slice(i, i + CHUNK)) {
        batch.update(w.ref, w.data);
      }
      await batch.commit();
    }
  }

  console.log(
    `\nDone. Updated ${submittedWrites.length} submitted verification(s) and ${userWrites.length} user config(s).`,
  );
}

async function main() {
  console.log(
    execute
      ? `EXECUTE — seal → ${NEW_SEAL} (project ${PROJECT_ID})\n`
      : `DRY RUN — pass --execute to write (project ${PROJECT_ID})\n`,
  );

  const adminDb = tryInitAdminSdk();
  if (adminDb) {
    await runViaAdmin(adminDb);
    return;
  }

  const token = gcloudAccessToken();
  await runViaRest(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
