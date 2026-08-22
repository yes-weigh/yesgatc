/**
 * Restore accidentally deleted issued siteCalibrations for the DSC Engine RC
 * using Firestore point-in-time / last-hour stale reads.
 *
 * Dry run:
 *   node scripts/restore-rc-test-certificates.mjs
 *
 * Write docs back:
 *   node scripts/restore-rc-test-certificates.mjs --execute
 */
import { existsSync, readFileSync } from 'node:fs';

const execute = process.argv.includes('--execute');
const PROJECT_ID = 'yesgatc';
const API_KEY = 'AIzaSyACjIT9hQNzAXDDZW7JaMMaVQgfyZi5oT4';
const RC_UID = '07FhPjLV4zghJ3AN6gjmFzV2I4q2';
const WORKER_CREDENTIALS = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}\\YesGATC\\CertificateWorker\\credentials.local.json`
  : '';

// Before the wipe (22 Aug 2026 ~10:31Z). Whole minute, within last hour.
const READ_TIMES = [
  process.env.RESTORE_READ_TIME?.trim(),
  '2026-08-22T10:20:00.000000Z',
  '2026-08-22T10:25:00.000000Z',
  '2026-08-22T10:15:00.000000Z',
  '2026-08-22T10:10:00.000000Z',
].filter(Boolean);

function firestoreValue(fields, key) {
  const value = fields?.[key];
  if (!value) return '';
  return value.stringValue || value.timestampValue || '';
}

async function signInSuperAdmin() {
  if (!WORKER_CREDENTIALS || !existsSync(WORKER_CREDENTIALS)) {
    throw new Error(`Missing ${WORKER_CREDENTIALS}`);
  }
  const stored = JSON.parse(readFileSync(WORKER_CREDENTIALS, 'utf8'));
  const aadhar = String(stored.superAdmin?.aadhar || '').replace(/\D/g, '');
  const password = stored.superAdmin?.password || '';
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
  if (!response.ok) throw new Error(body.error?.message || 'super admin sign-in failed');

  const user = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${body.localId}`,
    { headers: { Authorization: `Bearer ${body.idToken}` } },
  );
  const userBody = await user.json();
  const role = userBody.fields?.role?.stringValue || '';
  if (role !== 'super_admin') throw new Error(`need super_admin, got ${role || 'unknown'}`);
  return { uid: body.localId, idToken: body.idToken };
}

async function runQuery(token, readTime) {
  const rows = [];
  let pageToken = '';
  for (;;) {
    const payload = {
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
      readTime,
    };
    if (pageToken) payload.pageToken = pageToken;
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`runQuery ${response.status} @ ${readTime}: ${JSON.stringify(data).slice(0, 500)}`);
    }
    for (const row of data) {
      if (row.document?.name) rows.push(row.document);
    }
    const last = data[data.length - 1];
    pageToken = last?.nextPageToken || '';
    if (!pageToken) break;
  }
  return rows;
}

function issuedDocs(documents) {
  return documents
    .map(document => {
      const id = document.name.split('/').pop();
      const fields = document.fields || {};
      return {
        id,
        fields,
        status: firestoreValue(fields, 'status'),
        certificateNumber: firestoreValue(fields, 'certificateNumber'),
        supersededBy: firestoreValue(fields, 'supersededByResubmissionId'),
        customerName: firestoreValue(fields, 'customerName'),
      };
    })
    .filter(row =>
      row.status.toLowerCase() === 'certified'
      && row.certificateNumber
      && !row.supersededBy);
}

async function writeDocument(token, id, fields) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/siteCalibrations/${id}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`write ${id} ${response.status}: ${body.slice(0, 280)}`);
  }
}

async function mapPool(items, concurrency, worker) {
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
}

const admin = await signInSuperAdmin();
let documents = [];
let usedReadTime = '';
let lastError = '';
for (const readTime of READ_TIMES) {
  try {
    documents = await runQuery(admin.idToken, readTime);
    usedReadTime = readTime;
    console.log(`readTime ${readTime} -> ${documents.length} rc docs`);
    if (documents.length > 0) break;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.log(`readTime ${readTime} failed: ${lastError}`);
  }
}

const rows = issuedDocs(documents);
console.log(JSON.stringify({
  mode: execute ? 'EXECUTE' : 'DRY_RUN',
  usedReadTime,
  rcDocs: documents.length,
  issued: rows.length,
  sample: rows.slice(0, 3).map(row => ({
    id: row.id,
    certificateNumber: row.certificateNumber,
    customerName: row.customerName,
  })),
  lastError: lastError || undefined,
}, null, 2));

if (!execute) {
  console.log(rows.length
    ? 'Dry run. Re-run with --execute to write these documents back.'
    : 'No stale documents found.');
  process.exit(rows.length ? 0 : 1);
}

if (!rows.length) {
  throw new Error('Nothing to restore.');
}

let written = 0;
await mapPool(rows, 8, async (row, index) => {
  await writeDocument(admin.idToken, row.id, row.fields);
  written += 1;
  if ((index + 1) % 50 === 0 || index + 1 === rows.length) {
    console.log(`progress ${index + 1}/${rows.length} written=${written}`);
  }
});

console.log(JSON.stringify({ written }, null, 2));
