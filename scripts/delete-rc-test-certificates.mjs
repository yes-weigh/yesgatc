/**
 * Remove certified siteCalibrations shown in DSC Engine for one RC (test wipe).
 *
 * Dry run (default):
 *   node scripts/delete-rc-test-certificates.mjs
 *
 * Delete Firestore docs + Storage files:
 *   node scripts/delete-rc-test-certificates.mjs --execute
 *
 * Auth: DSC Engine saved RC login + gcloud access token (IAM, bypasses rules).
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const execute = process.argv.includes('--execute');
const PROJECT_ID = 'yesgatc';
const API_KEY = 'AIzaSyACjIT9hQNzAXDDZW7JaMMaVQgfyZi5oT4';
const BUCKET = 'yesgatc.firebasestorage.app';
const DSC_CREDENTIALS = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}\\YesGATC\\DscEngine\\credentials.local.json`
  : '';
const WORKER_CREDENTIALS = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}\\YesGATC\\CertificateWorker\\credentials.local.json`
  : '';

function gcloudToken() {
  const fromEnv = process.env.GCLOUD_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return execFileSync(
    process.platform === 'win32' ? 'cmd.exe' : 'sh',
    process.platform === 'win32'
      ? ['/c', 'gcloud.cmd auth print-access-token']
      : ['-lc', 'gcloud auth print-access-token'],
    { encoding: 'utf8' },
  ).trim();
}

function firestoreValue(fields, key) {
  const value = fields?.[key];
  if (!value) return '';
  return value.stringValue || value.timestampValue || '';
}

async function signInFromFile(path, label) {
  if (!path || !existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  const aadhar = String(stored.superAdmin?.aadhar || stored.rc?.aadhar || '').replace(/\D/g, '');
  const password = stored.superAdmin?.password || stored.rc?.password || '';
  if (aadhar.length !== 12 || !password) {
    throw new Error(`${label} login is empty.`);
  }

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
    throw new Error(body.error?.message || `${label} sign-in failed`);
  }

  const user = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${body.localId}`,
    { headers: { Authorization: `Bearer ${body.idToken}` } },
  );
  const userBody = await user.json();
  const role = userBody.fields?.role?.stringValue || '';
  return { uid: body.localId, idToken: body.idToken, aadhar, role };
}

async function runQuery(token, structuredQuery) {
  const rows = [];
  let pageToken = '';
  for (;;) {
    const payload = { structuredQuery };
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
      throw new Error(`runQuery ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
    }
    for (const row of data) {
      if (row.document?.name) rows.push(row.document);
      if (row.readTime && row.nextPageToken) pageToken = row.nextPageToken;
    }
    const last = data[data.length - 1];
    pageToken = last?.nextPageToken || '';
    if (!pageToken) break;
  }
  return rows;
}

async function listIssued(token, rcId) {
  const documents = await runQuery(token, {
    from: [{ collectionId: 'siteCalibrations' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'rcId' },
        op: 'EQUAL',
        value: { stringValue: rcId },
      },
    },
  });

  return documents
    .map(document => {
      const id = document.name.split('/').pop();
      const fields = document.fields || {};
      return {
        id,
        status: firestoreValue(fields, 'status'),
        certificateNumber: firestoreValue(fields, 'certificateNumber'),
        customerName: firestoreValue(fields, 'customerName'),
        verificationType: firestoreValue(fields, 'verificationType'),
        certifiedAt: firestoreValue(fields, 'certifiedAt'),
        supersededBy: firestoreValue(fields, 'supersededByResubmissionId'),
        storagePaths: collectStoragePaths(id, fields),
      };
    })
    .filter(row =>
      row.status.toLowerCase() === 'certified'
      && row.certificateNumber
      && !row.supersededBy);
}

function collectStoragePaths(id, fields) {
  const paths = new Set();
  for (const value of Object.values(fields)) {
    const text = value?.stringValue || '';
    if (!text) continue;
    const fromUrl = text.match(/\/o\/([^?]+)/);
    if (fromUrl) {
      paths.add(decodeURIComponent(fromUrl[1]));
      continue;
    }
    if (text.startsWith(`siteCalibrations/${id}/`)) {
      paths.add(text);
    }
  }
  return [...paths];
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

async function deleteStorageFile(idToken, name) {
  const url =
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`storage delete ${name} ${response.status}: ${body.slice(0, 240)}`);
  }
}

async function mapPool(items, concurrency, worker) {
  const results = [];
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function countBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key] || '—';
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

const rc = await signInFromFile(DSC_CREDENTIALS, 'DSC Engine');
const rows = await listIssued(rc.idToken, rc.uid);

function rowDay(row) {
  const raw = row.certifiedAt;
  if (!raw) return 'none';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw.slice(0, 10) : date.toISOString().slice(0, 10);
}

const customers = countBy(rows, 'customerName');
const types = countBy(rows, 'verificationType');
const days = countBy(rows.map(row => ({ day: rowDay(row) })), 'day');

console.log(JSON.stringify({
  mode: execute ? 'EXECUTE' : 'DRY_RUN',
  rcUid: rc.uid,
  aadhar: rc.aadhar,
  issued: rows.length,
  customers: customers.slice(0, 8),
  types,
  certifiedDays: days.slice(0, 8),
  sample: rows.slice(0, 5).map(row => ({
    id: row.id,
    certificateNumber: row.certificateNumber,
    customerName: row.customerName,
    certifiedAt: row.certifiedAt,
  })),
}, null, 2));

if (!execute) {
  console.log('Dry run. Re-run with --execute to delete these issued certificates + Storage files.');
  process.exit(0);
}

const admin = await signInFromFile(WORKER_CREDENTIALS, 'Certificate Worker');
if (admin.role !== 'super_admin') {
  throw new Error(`Certificate Worker login is ${admin.role || 'unknown'}, need super_admin.`);
}

let deletedDocs = 0;
let deletedFiles = 0;
let fileErrors = 0;
await mapPool(rows, 6, async (row, index) => {
  for (const name of row.storagePaths) {
    try {
      await deleteStorageFile(rc.idToken, name);
      deletedFiles += 1;
    } catch {
      fileErrors += 1;
    }
  }
  await patchDraft(admin.idToken, row.id);
  await deleteDocument(admin.idToken, row.id);
  deletedDocs += 1;
  if ((index + 1) % 50 === 0 || index + 1 === rows.length) {
    console.log(`progress ${index + 1}/${rows.length} docs=${deletedDocs} files=${deletedFiles} fileErrors=${fileErrors}`);
  }
});

console.log(JSON.stringify({ deletedDocs, deletedFiles, fileErrors }, null, 2));
