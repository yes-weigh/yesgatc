/**
 * Clear DSC signed-PDF fields on specific certificates. Does not delete records.
 *
 *   node scripts/unsign-dsc-test-certificates.mjs --execute
 */
import { existsSync, readFileSync } from 'node:fs';

const execute = process.argv.includes('--execute');
const PROJECT_ID = 'yesgatc';
const API_KEY = 'AIzaSyACjIT9hQNzAXDDZW7JaMMaVQgfyZi5oT4';
const BUCKET = 'yesgatc.firebasestorage.app';
const RC_UID = '07FhPjLV4zghJ3AN6gjmFzV2I4q2';
const TARGETS = new Set([
  'IND/GATC/KL/26/04/26/3636',
  'IND/GATC/KL/26/04/26/3635',
  'IND/GATC/KL/26/04/26/3634',
  'IND/GATC/KL/26/04/26/3633',
  'IND/GATC/KL/26/04/26/3632',
  'IND/GATC/KL/26/04/26/3631',
  'IND/GATC/KL/26/04/26/3616',
]);
const SIGNED_FIELDS = [
  'signedCertificatePdfUrl',
  'signedCertificatePdfPath',
  'signedCertificatePdfName',
  'signedCertificatePdfContentType',
  'signedCertificateUploadedAt',
  'signedCertificateUploadedByUid',
];
const DSC_CREDENTIALS = `${process.env.LOCALAPPDATA}\\YesGATC\\DscEngine\\credentials.local.json`;
const WORKER_CREDENTIALS = `${process.env.LOCALAPPDATA}\\YesGATC\\CertificateWorker\\credentials.local.json`;

function str(fields, key) {
  return fields?.[key]?.stringValue || '';
}

async function signIn(path) {
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  const aadhar = String(stored.superAdmin?.aadhar || '').replace(/\D/g, '');
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${aadhar}@yesgatc.auth`,
        password: stored.superAdmin.password,
        returnSecureToken: true,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'sign-in failed');
  return { uid: body.localId, idToken: body.idToken };
}

async function runQuery(token) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'siteCalibrations' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'rcId' },
              op: 'EQUAL',
              value: { stringValue: RC_UID },
            },
          },
        },
      }),
    },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data).slice(0, 300));
  return data.filter(row => row.document).map(row => row.document);
}

async function deleteStorage(idToken, name) {
  const response = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(name)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!response.ok && response.status !== 404 && response.status !== 400) {
    throw new Error(`storage ${name} ${response.status}`);
  }
}

async function clearSigned(token, id) {
  const mask = [...SIGNED_FIELDS, 'updatedAt']
    .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');
  const fields = Object.fromEntries(SIGNED_FIELDS.map(key => [key, { nullValue: null }]));
  fields.updatedAt = { stringValue: new Date().toISOString() };
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/siteCalibrations/${id}?${mask}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
  );
  if (!response.ok) {
    throw new Error(`patch ${id} ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
}

if (!existsSync(DSC_CREDENTIALS) || !existsSync(WORKER_CREDENTIALS)) {
  throw new Error('Missing saved logins.');
}

const rc = await signIn(DSC_CREDENTIALS);
const admin = await signIn(WORKER_CREDENTIALS);
const matches = (await runQuery(rc.idToken))
  .map(document => {
    const id = document.name.split('/').pop();
    const fields = document.fields || {};
    return {
      id,
      certificateNumber: str(fields, 'certificateNumber'),
      signedUrl: str(fields, 'signedCertificatePdfUrl'),
      signedPath: str(fields, 'signedCertificatePdfPath'),
    };
  })
  .filter(row => TARGETS.has(row.certificateNumber));

console.log(JSON.stringify({
  mode: execute ? 'EXECUTE' : 'DRY_RUN',
  found: matches.map(row => ({
    id: row.id,
    certificateNumber: row.certificateNumber,
    hasSigned: Boolean(row.signedUrl || row.signedPath),
  })),
}, null, 2));

if (matches.length !== TARGETS.size) {
  throw new Error(`Expected ${TARGETS.size} rows, found ${matches.length}.`);
}

if (!execute) {
  console.log('Dry run. Re-run with --execute to clear DSC signed fields only.');
  process.exit(0);
}

for (const row of matches) {
  if (row.signedPath) {
    await deleteStorage(rc.idToken, row.signedPath);
  }
  await clearSigned(admin.idToken, row.id);
  console.log('unsigned', row.certificateNumber);
}
