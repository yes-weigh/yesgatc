/**
 * Promote draft siteCalibrations → submitted when they have everything
 * the eMAAP certificate worker needs (party + instrument + all photo URLs).
 * Incomplete drafts stay draft.
 *
 * Dry run (default):
 *   npm run backfill:drafts-to-submitted
 *
 * Apply:
 *   npm run backfill:drafts-to-submitted -- --execute
 *
 * Auth: FIREBASE_SERVICE_ACCOUNT_PATH, GOOGLE_APPLICATION_CREDENTIALS, or gcloud user token.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const execute = process.argv.includes('--execute');
const PROJECT_ID =
  process.env.GCLOUD_PROJECT?.trim() ||
  process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
  'yesgatc';
const DEFAULT_SEAL = 'IND/GATC/KL/26/04/C26';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const IMAGE_FIELDS = [
  ['stampingImageUrl', 'Serial number plate photo'],
  ['scaleImageUrl', 'Instrument / scale photo'],
  ['instrumentRearImageUrl', 'Instrument rear photo'],
  ['standardWeightImageUrl', 'Standard weight photo'],
  ['verificationSealImageUrl', 'Verification seal photo'],
];

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
    initializeApp({
      credential: cert(JSON.parse(readFileSync(path, 'utf8'))),
      projectId: PROJECT_ID,
    });
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

function str(v) {
  if (v == null) return '';
  return String(v).trim();
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isHttpUrl(v) {
  const s = str(v);
  return /^https?:\/\//i.test(s);
}

function normalizePincode(v) {
  return str(v).replace(/\D/g, '');
}

function isValidPincode(v) {
  return /^\d{6}$/.test(normalizePincode(v));
}

function normalizeMobile(v) {
  const digits = str(v).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return '';
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (str(v)) return str(v);
  }
  return '';
}

function decodeFirestoreValue(v) {
  if (v == null) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
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
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function restListCollection(token, collectionId, pageSize = 300) {
  const docs = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await restJson(
      'GET',
      `${BASE}/${collectionId}?${qs}`,
      token,
    );
    for (const doc of data?.documents || []) {
      const fields = {};
      for (const [k, v] of Object.entries(doc.fields || {})) {
        fields[k] = decodeFirestoreValue(v);
      }
      docs.push({ id: docIdFromName(doc.name), name: doc.name, data: fields });
    }
    pageToken = data?.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function restGetDoc(token, collectionId, id) {
  try {
    const data = await restJson('GET', `${BASE}/${collectionId}/${id}`, token);
    const fields = {};
    for (const [k, v] of Object.entries(data?.fields || {})) {
      fields[k] = decodeFirestoreValue(v);
    }
    return fields;
  } catch (err) {
    if (String(err.message).includes('404')) return null;
    throw err;
  }
}

/**
 * Mirror InstrumentDetailsService + PartyDetailsService + require all 5 eMAAP photos.
 * @returns {string[]} missing reasons (empty = ready)
 */
function evaluateEmaapReady(record, ctx) {
  const missing = [];
  const {
    product,
    customer,
    rc,
    performer,
  } = ctx;

  if (str(record.supersededByResubmissionId)) {
    missing.push('superseded by resubmission');
    return missing;
  }
  if (str(record.certificateVoidedAt)) {
    missing.push('certificate voided');
    return missing;
  }

  const verificationType = str(record.verificationType).toUpperCase();
  if (verificationType !== 'OV' && verificationType !== 'RV') {
    missing.push(`verificationType (${record.verificationType || 'empty'})`);
  }

  const rcId = str(record.rcId);
  if (!rcId) missing.push('rcId');

  const applicationNumber = str(record.applicationNumber);
  if (!applicationNumber) missing.push('applicationNumber');

  const serialNumber = str(record.serialNumber);
  if (!serialNumber) missing.push('serialNumber');

  const verificationLocation = firstNonEmpty(record.verificationLocation, 'in_situ');
  if (verificationLocation !== 'in_situ' && verificationLocation !== 'in_premises') {
    missing.push(`verificationLocation (${verificationLocation})`);
  }

  if (!str(record.ambientTemperature)) missing.push('ambientTemperature');
  if (!str(record.relativeHumidity)) missing.push('relativeHumidity');

  for (const [field, label] of IMAGE_FIELDS) {
    if (!isHttpUrl(record[field])) missing.push(`${label} (${field})`);
  }

  // Product / capacities
  if (!product) {
    missing.push(str(record.productId) ? `product ${record.productId} not found` : 'productId');
  } else {
    if (!str(product.manufacturerBrandSeries)) missing.push('product.manufacturerBrandSeries');
    if (!str(product.modelApprovalNo)) missing.push('product.modelApprovalNo');

    const maxCapacity = num(record.maximumCapacity) ?? num(product.maximumCapacity);
    const minCapacity = num(product.minimumCapacity);
    const e = num(record.verificationScaleInterval) ?? num(product.verificationScaleInterval);
    const d = num(product.actualScaleInterval) ?? e;
    let n = num(product.noOfVerificationIntervals);
    if (n == null && maxCapacity > 0 && e > 0) {
      n = (maxCapacity * 1000) / e;
    }
    const mpe = num(record.maximumPermissibleError) ?? num(product.maximumPermissibleError);

    if (!(maxCapacity > 0)) missing.push('maximumCapacity');
    if (!(minCapacity > 0)) missing.push('product.minimumCapacity');
    if (!(e > 0)) missing.push('verificationScaleInterval (e)');
    if (!(d > 0)) missing.push('actualScaleInterval (d)');
    if (!(n > 0)) missing.push('noOfVerificationIntervals (n)');
    if (mpe == null) missing.push('maximumPermissibleError (MPE)');
  }

  const seal = firstNonEmpty(
    record.sealIdentificationNumber,
    rc?.laboratorySealIdentification,
    DEFAULT_SEAL,
  );
  if (!seal) missing.push('sealIdentificationNumber');

  if (verificationType === 'RV') {
    const year = num(record.manufacturingYear);
    if (!(year > 0)) missing.push('manufacturingYear (RV)');
    const zoho = firstNonEmpty(record.zohoInvoiceNumber, record.zohoInvoiceId);
    if (!zoho) missing.push('zohoInvoiceNumber (RV money receipt)');
  }

  // Party
  const verificationSubject = str(record.verificationSubject) || 'customer';
  const customerId = str(record.customerId);
  const isSelf =
    verificationSubject === 'self' || (customerId && rcId && customerId === rcId);

  let name = '';
  let address = '';
  let pincode = '';
  let state = '';
  let district = '';

  if (isSelf) {
    if (!rc) {
      missing.push('RC user profile missing for self verification');
    } else {
      name = firstNonEmpty(rc.companyName, rc.username, record.customerName);
      address = str(rc.address);
      pincode = normalizePincode(rc.pincode);
    }
  } else {
    if (!customerId) {
      missing.push('customerId');
    } else if (!customer) {
      missing.push(`customer ${customerId} not found`);
    } else {
      name = firstNonEmpty(customer.name, record.customerName);
      address = str(customer.address);
      pincode = normalizePincode(customer.pincode);
      state = str(customer.state);
      district = str(customer.district);
    }
  }

  if (!name) missing.push('party name (customer/RC)');
  if (!address) missing.push('party address');
  if (!isValidPincode(pincode)) missing.push('party pincode (6 digits)');
  // State/district can be resolved from pincode at runtime; prefer stored when present.
  // Require at least pincode; if stored state/district empty, worker looks up — allow if pincode valid.
  void state;
  void district;

  if (!performer) {
    missing.push('performer user (RC/VCT) missing');
  } else if (!normalizeMobile(performer.phone)) {
    missing.push('performer phone (10-digit RC/VCT mobile)');
  }

  return missing;
}

function resolvePerformerIds(record) {
  const performedBy = str(record.performedBy);
  const vctId = str(record.vctId);
  const rcId = str(record.rcId);
  const useVct = performedBy === 'vct' || (vctId && performedBy !== 'rc');
  if (useVct && vctId) return { performerId: vctId, label: 'VCT' };
  return { performerId: rcId, label: 'RC' };
}

async function loadCachesAdmin(db, drafts) {
  const productIds = new Set();
  const customerIds = new Set();
  const userIds = new Set();

  for (const d of drafts) {
    if (str(d.productId)) productIds.add(str(d.productId));
    if (str(d.customerId)) customerIds.add(str(d.customerId));
    if (str(d.rcId)) userIds.add(str(d.rcId));
    const { performerId } = resolvePerformerIds(d);
    if (performerId) userIds.add(performerId);
  }

  const products = new Map();
  const customers = new Map();
  const users = new Map();

  await Promise.all([
    ...[...productIds].map(async id => {
      const snap = await db.collection('products').doc(id).get();
      if (snap.exists) products.set(id, snap.data() || {});
    }),
    ...[...customerIds].map(async id => {
      const snap = await db.collection('customers').doc(id).get();
      if (snap.exists) customers.set(id, snap.data() || {});
    }),
    ...[...userIds].map(async id => {
      const snap = await db.collection('users').doc(id).get();
      if (snap.exists) users.set(id, snap.data() || {});
    }),
  ]);

  return { products, customers, users };
}

async function loadCachesRest(token, drafts) {
  const productIds = new Set();
  const customerIds = new Set();
  const userIds = new Set();

  for (const d of drafts) {
    if (str(d.productId)) productIds.add(str(d.productId));
    if (str(d.customerId)) customerIds.add(str(d.customerId));
    if (str(d.rcId)) userIds.add(str(d.rcId));
    const { performerId } = resolvePerformerIds(d);
    if (performerId) userIds.add(performerId);
  }

  const products = new Map();
  const customers = new Map();
  const users = new Map();

  for (const id of productIds) {
    const data = await restGetDoc(token, 'products', id);
    if (data) products.set(id, data);
  }
  for (const id of customerIds) {
    const data = await restGetDoc(token, 'customers', id);
    if (data) customers.set(id, data);
  }
  for (const id of userIds) {
    const data = await restGetDoc(token, 'users', id);
    if (data) users.set(id, data);
  }

  return { products, customers, users };
}

function buildCtx(record, caches) {
  const rcId = str(record.rcId);
  const customerId = str(record.customerId);
  const { performerId } = resolvePerformerIds(record);
  return {
    product: str(record.productId) ? caches.products.get(str(record.productId)) : null,
    customer: customerId ? caches.customers.get(customerId) : null,
    rc: rcId ? caches.users.get(rcId) : null,
    performer: performerId ? caches.users.get(performerId) : null,
  };
}

async function runViaAdmin(db) {
  console.log(
    execute
      ? `EXECUTE — promote eMAAP-ready drafts → submitted (project ${PROJECT_ID})\n`
      : `DRY RUN — pass --execute to write (project ${PROJECT_ID})\n`,
  );

  const snap = await db.collection('siteCalibrations').where('status', '==', 'draft').get();
  const drafts = snap.docs.map(docSnap => ({
    id: docSnap.id,
    ref: docSnap.ref,
    ...docSnap.data(),
  }));

  console.log(`Drafts found: ${drafts.length}`);
  const caches = await loadCachesAdmin(db, drafts);

  const ready = [];
  const keep = [];

  for (const record of drafts) {
    const missing = evaluateEmaapReady(record, buildCtx(record, caches));
    if (missing.length === 0) {
      ready.push(record);
    } else {
      keep.push({ id: record.id, serial: str(record.serialNumber), missing });
    }
  }

  console.log(`\nReady to submit: ${ready.length}`);
  for (const r of ready.slice(0, 40)) {
    console.log(
      `  ✓ ${r.id} · ${str(r.serialNumber) || '(no serial)'} · ${str(r.verificationType) || '?'} · ${str(r.customerName) || ''}`,
    );
  }
  if (ready.length > 40) console.log(`  … +${ready.length - 40} more`);

  console.log(`\nKeep as draft: ${keep.length}`);
  for (const row of keep.slice(0, 30)) {
    console.log(`  · ${row.id} · ${row.serial || '(no serial)'} — ${row.missing.join('; ')}`);
  }
  if (keep.length > 30) console.log(`  … +${keep.length - 30} more`);

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to mark ready drafts as submitted.');
    return;
  }

  if (ready.length === 0) {
    console.log('\nNothing to update.');
    return;
  }

  const now = new Date().toISOString();
  let batch = db.batch();
  let ops = 0;
  let committed = 0;

  for (const r of ready) {
    batch.update(r.ref, {
      status: 'submitted',
      submittedAt: now,
      updatedAt: now,
      pipelineFailedPhase: FieldValue.delete(),
      pipelineFailureMessage: FieldValue.delete(),
      pipelineFailedAt: FieldValue.delete(),
    });
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      committed += ops;
      console.log(`Committed ${committed} / ${ready.length}`);
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
    committed += ops;
  }

  console.log(`\nDone. Marked ${committed} draft(s) as submitted. Left ${keep.length} as draft.`);
}

async function runViaRest(token) {
  console.log(
    execute
      ? `EXECUTE (REST) — promote eMAAP-ready drafts → submitted (project ${PROJECT_ID})\n`
      : `DRY RUN (REST) — pass --execute to write (project ${PROJECT_ID})\n`,
  );

  const all = await restListCollection(token, 'siteCalibrations');
  const drafts = all.filter(d => str(d.data.status) === 'draft').map(d => ({ id: d.id, name: d.name, ...d.data }));
  console.log(`Drafts found: ${drafts.length} (scanned ${all.length} calibrations)`);

  const caches = await loadCachesRest(token, drafts);
  const ready = [];
  const keep = [];

  for (const record of drafts) {
    const missing = evaluateEmaapReady(record, buildCtx(record, caches));
    if (missing.length === 0) ready.push(record);
    else keep.push({ id: record.id, serial: str(record.serialNumber), missing });
  }

  console.log(`\nReady to submit: ${ready.length}`);
  for (const r of ready.slice(0, 40)) {
    console.log(
      `  ✓ ${r.id} · ${str(r.serialNumber) || '(no serial)'} · ${str(r.verificationType) || '?'} · ${str(r.customerName) || ''}`,
    );
  }
  console.log(`\nKeep as draft: ${keep.length}`);
  for (const row of keep.slice(0, 30)) {
    console.log(`  · ${row.id} · ${row.serial || '(no serial)'} — ${row.missing.join('; ')}`);
  }

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to mark ready drafts as submitted.');
    return;
  }

  if (ready.length === 0) {
    console.log('\nNothing to update.');
    return;
  }

  const now = new Date().toISOString();
  const writes = ready.map(r => ({
    update: {
      name: r.name || `${BASE}/siteCalibrations/${r.id}`,
      fields: {
        status: { stringValue: 'submitted' },
        submittedAt: { stringValue: now },
        updatedAt: { stringValue: now },
      },
    },
    updateMask: {
      fieldPaths: ['status', 'submittedAt', 'updatedAt'],
    },
    currentDocument: { exists: true },
  }));

  const commitUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
  const CHUNK = 200;
  for (let i = 0; i < writes.length; i += CHUNK) {
    await restJson('POST', commitUrl, token, { writes: writes.slice(i, i + CHUNK) });
    console.log(`Committed ${Math.min(i + CHUNK, writes.length)} / ${writes.length}`);
  }

  console.log(`\nDone. Marked ${ready.length} draft(s) as submitted. Left ${keep.length} as draft.`);
}

async function main() {
  const db = tryInitAdminSdk();
  if (db) {
    await runViaAdmin(db);
    return;
  }

  console.log('Auth: gcloud access token (Firestore REST)');
  const token = gcloudAccessToken();
  await runViaRest(token);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
