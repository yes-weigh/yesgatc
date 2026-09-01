/**
 * Delete one OV siteCalibration by serial (releases seat).
 *
 *   node scripts/delete-ov-by-serial.mjs --serial=G0550
 *   node scripts/delete-ov-by-serial.mjs --serial=G0550 --execute
 *
 * Auth: EmaapEngine credentials.local.json (superAdmin).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execute = process.argv.includes('--execute');
const PROJECT_ID = 'yesgatc';
const API_KEY = 'AIzaSyACjIT9hQNzAXDDZW7JaMMaVQgfyZi5oT4';
const CREDENTIALS = join(
  homedir(),
  'Library/Application Support/YesGATC/EmaapEngine/credentials.local.json',
);

function argValue(flag) {
  const raw = process.argv.find(a => a.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1).trim() : '';
}

const SERIAL = (argValue('--serial') || 'G0550').trim();
const APP_NO = (argValue('--app') || '').trim();

function firestoreValue(fields, key) {
  const value = fields?.[key];
  if (!value) return '';
  return value.stringValue || value.timestampValue || '';
}

async function signInAdmin() {
  if (!existsSync(CREDENTIALS)) {
    throw new Error(`Missing ${CREDENTIALS}`);
  }
  const stored = JSON.parse(readFileSync(CREDENTIALS, 'utf8'));
  const candidates = [
    stored.superAdmin,
    stored.rc,
  ].filter(Boolean);

  let lastError = 'no credentials';
  for (const entry of candidates) {
    const aadhar = String(entry.aadhar || '').replace(/\D/g, '');
    const password = entry.password || '';
    if (aadhar.length !== 12 || !password) continue;

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `${aadhar}@yesgatc.auth`,
          password,
          returnSecureToken: true,
        }),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      lastError = body.error?.message || 'sign-in failed';
      continue;
    }

    const user = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${body.localId}`,
      { headers: { Authorization: `Bearer ${body.idToken}` } },
    );
    const userBody = await user.json();
    const role = userBody.fields?.role?.stringValue || '';
    return { uid: body.localId, idToken: body.idToken, role, aadhar };
  }

  throw new Error(lastError);
}

async function runQuery(token, structuredQuery) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ structuredQuery }),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`runQuery ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data.filter(row => row.document?.name).map(row => row.document);
}

async function findTargets(token, actor) {
  const filters = [];
  if (actor.role === 'rc_admin') {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'rcId' },
        op: 'EQUAL',
        value: { stringValue: actor.uid },
      },
    });
  }
  filters.push({
    fieldFilter: {
      field: { fieldPath: 'serialNumber' },
      op: 'EQUAL',
      value: { stringValue: SERIAL },
    },
  });

  const documents = await runQuery(token, {
    from: [{ collectionId: 'siteCalibrations' }],
    where: filters.length === 1
      ? filters[0]
      : { compositeFilter: { op: 'AND', filters } },
  });

  return documents
    .map(document => {
      const id = document.name.split('/').pop();
      const fields = document.fields || {};
      return {
        id,
        status: firestoreValue(fields, 'status'),
        verificationType: firestoreValue(fields, 'verificationType'),
        serialNumber: firestoreValue(fields, 'serialNumber'),
        applicationNumber: firestoreValue(fields, 'applicationNumber'),
        certificateNumber: firestoreValue(fields, 'certificateNumber'),
        customerName: firestoreValue(fields, 'customerName'),
        rcId: firestoreValue(fields, 'rcId'),
        createdAt: firestoreValue(fields, 'createdAt'),
        submittedAt: firestoreValue(fields, 'submittedAt'),
        certifiedAt: firestoreValue(fields, 'certifiedAt'),
      };
    })
    .filter(row => {
      if (APP_NO && row.applicationNumber !== APP_NO && row.certificateNumber !== APP_NO) {
        return false;
      }
      return true;
    });
}

async function patchDraft(token, id) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/siteCalibrations/${id}?updateMask.fieldPaths=status`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: { status: { stringValue: 'draft' } },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`draft ${id} ${response.status}: ${body.slice(0, 240)}`);
  }
}

async function deleteDocument(token, id) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/siteCalibrations/${id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`delete ${id} ${response.status}: ${body.slice(0, 240)}`);
  }
}

const admin = await signInAdmin();
const rows = await findTargets(admin.idToken, admin);

console.log(JSON.stringify({
  mode: execute ? 'EXECUTE' : 'DRY_RUN',
  actor: { uid: admin.uid, role: admin.role, aadhar: `${admin.aadhar.slice(0, 4)}****` },
  serial: SERIAL,
  appFilter: APP_NO || null,
  matches: rows,
}, null, 2));

if (!rows.length) {
  console.error('No matching siteCalibrations found.');
  process.exit(1);
}

if (admin.role === 'rc_admin') {
  const foreign = rows.filter(row => row.rcId && row.rcId !== admin.uid);
  if (foreign.length) {
    console.error('RC login cannot delete records for another centre:', foreign.map(r => r.id));
    process.exit(1);
  }
}

if (!execute) {
  console.log('Dry run OK. Re-run with --execute to delete and release serial.');
  process.exit(0);
}

for (const row of rows) {
  if (String(row.status).toLowerCase() !== 'draft') {
    await patchDraft(admin.idToken, row.id);
    console.log('set draft', row.id, row.status, '→ draft');
  }
  await deleteDocument(admin.idToken, row.id);
  console.log('deleted', row.id, row.serialNumber, row.applicationNumber || row.certificateNumber);
}

console.log(`Done. Serial ${SERIAL} released for OV (no longer counted as used).`);
