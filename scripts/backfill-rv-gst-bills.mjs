/**
 * Snapshot RV GST bills onto siteCalibrations.gstBill using dated rates:
 *   through 18 Aug 2026 IST: ₹150 / ₹250 + 18% GST
 *   after 18 Aug 2026 IST:   ₹200 / ₹350 + 18% GST
 *
 * Date = certifiedAt || submittedAt || approvedAt || createdAt (IST calendar day).
 *
 * Dry run (default):
 *   npm run backfill:rv-gst-bills
 *
 * Apply:
 *   npm run backfill:rv-gst-bills -- --execute
 *
 * Auth: FIREBASE_SERVICE_ACCOUNT_PATH, GOOGLE_APPLICATION_CREDENTIALS, or gcloud user token.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const execute = process.argv.includes('--execute');
const PROJECT_ID = process.env.GCLOUD_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || 'yesgatc';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const CUTOVER = '2026-08-18';
const THROUGH = { upto20Kg: 150, above20Kg: 250 };
const AFTER = { upto20Kg: 200, above20Kg: 350 };

function gcloudAccessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    return execFileSync('gcloud.cmd', ['auth', 'print-access-token'], {
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

function istDateKey(iso) {
  if (!iso || !String(iso).trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function capacityKg(record) {
  const cap = Number(record.maximumCapacity);
  if (!Number.isFinite(cap)) return null;
  if (record.unitOfMeasurement === 'g') return cap / 1000;
  return cap;
}

function roundPaise(amount) {
  return Math.round(amount * 100) / 100;
}

function computeGstBill(record, storedAt) {
  if (String(record.verificationType || '').toUpperCase() !== 'RV') return null;
  const kg = capacityKg(record);
  if (kg == null) return null;
  const rateDate = istDateKey(
    record.certifiedAt || record.submittedAt || record.approvedAt || record.createdAt,
  );
  if (!rateDate) return null;
  const rates = rateDate <= CUTOVER ? THROUGH : AFTER;
  const taxableValue = kg <= 20 ? rates.upto20Kg : rates.above20Kg;
  const cgstAmount = roundPaise(taxableValue * 0.09);
  const sgstAmount = roundPaise(taxableValue * 0.09);
  return {
    taxableValue,
    cgstAmount,
    sgstAmount,
    totalAmount: roundPaise(taxableValue + cgstAmount + sgstAmount),
    feeUpto20KgInr: rates.upto20Kg,
    feeAbove20KgInr: rates.above20Kg,
    rateDate,
    storedAt,
  };
}

function billsMatch(a, b) {
  if (!a || !b) return false;
  return (
    a.taxableValue === b.taxableValue
    && a.cgstAmount === b.cgstAmount
    && a.sgstAmount === b.sgstAmount
    && a.totalAmount === b.totalAmount
    && a.feeUpto20KgInr === b.feeUpto20KgInr
    && a.feeAbove20KgInr === b.feeAbove20KgInr
    && a.rateDate === b.rateDate
  );
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

function encodeNumber(n) {
  return Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n };
}

function encodeGstBill(bill) {
  return {
    mapValue: {
      fields: {
        taxableValue: encodeNumber(bill.taxableValue),
        cgstAmount: encodeNumber(bill.cgstAmount),
        sgstAmount: encodeNumber(bill.sgstAmount),
        totalAmount: encodeNumber(bill.totalAmount),
        feeUpto20KgInr: encodeNumber(bill.feeUpto20KgInr),
        feeAbove20KgInr: encodeNumber(bill.feeAbove20KgInr),
        rateDate: { stringValue: bill.rateDate },
        storedAt: { stringValue: bill.storedAt },
      },
    },
  };
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

function summarize(writes, skipped, missing) {
  const oldRates = writes.filter((w) => w.bill.rateDate <= CUTOVER).length;
  const newRates = writes.length - oldRates;
  console.log(`RV records scanned for GST bill`);
  console.log(`  would update: ${writes.length}  (through ${CUTOVER}: ${oldRates}, after: ${newRates})`);
  console.log(`  already correct: ${skipped}`);
  console.log(`  skipped (no capacity/date): ${missing}`);
  for (const w of writes.slice(0, 20)) {
    console.log(
      `    ${w.id}  ${w.bill.rateDate}  max ${w.kg}kg  taxable ₹${w.bill.taxableValue}  total ₹${w.bill.totalAmount}`,
    );
  }
  if (writes.length > 20) console.log(`    … +${writes.length - 20} more`);
}

async function runViaRest(token) {
  console.log('Auth: gcloud user access token (Firestore REST)');
  const storedAt = new Date().toISOString();
  const writes = [];
  let skipped = 0;
  let missing = 0;
  let pageToken = '';

  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const page = await restJson('GET', `${BASE}/siteCalibrations?${qs}`, token);
    for (const doc of page.documents || []) {
      const fields = doc.fields || {};
      const record = {
        verificationType: decodeFirestoreValue(fields.verificationType),
        maximumCapacity: decodeFirestoreValue(fields.maximumCapacity),
        unitOfMeasurement: decodeFirestoreValue(fields.unitOfMeasurement),
        certifiedAt: decodeFirestoreValue(fields.certifiedAt),
        submittedAt: decodeFirestoreValue(fields.submittedAt),
        approvedAt: decodeFirestoreValue(fields.approvedAt),
        createdAt: decodeFirestoreValue(fields.createdAt),
        gstBill: decodeFirestoreValue(fields.gstBill),
      };
      if (String(record.verificationType || '').toUpperCase() !== 'RV') continue;
      const bill = computeGstBill(record, storedAt);
      const id = docIdFromName(doc.name);
      if (!bill) {
        missing += 1;
        continue;
      }
      if (billsMatch(record.gstBill, bill)) {
        skipped += 1;
        continue;
      }
      writes.push({
        id,
        name: doc.name,
        bill,
        kg: capacityKg(record),
      });
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  summarize(writes, skipped, missing);
  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to apply.');
    return;
  }

  const commitUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
  const CHUNK = 200;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const chunk = writes.slice(i, i + CHUNK).map((w) => ({
      update: {
        name: w.name,
        fields: { gstBill: encodeGstBill(w.bill) },
      },
      updateMask: { fieldPaths: ['gstBill'] },
      currentDocument: { exists: true },
    }));
    await restJson('POST', commitUrl, token, { writes: chunk });
    console.log(`Committed ${Math.min(i + CHUNK, writes.length)} / ${writes.length}`);
  }
  console.log(`\nDone. Stored GST bills on ${writes.length} RV record(s).`);
}

async function runViaAdmin(db) {
  const storedAt = new Date().toISOString();
  const snap = await db.collection('siteCalibrations').where('verificationType', '==', 'RV').get();
  const writes = [];
  let skipped = 0;
  let missing = 0;

  for (const docSnap of snap.docs) {
    const record = docSnap.data() || {};
    const bill = computeGstBill(record, storedAt);
    if (!bill) {
      missing += 1;
      continue;
    }
    if (billsMatch(record.gstBill, bill)) {
      skipped += 1;
      continue;
    }
    writes.push({
      ref: docSnap.ref,
      id: docSnap.id,
      bill,
      kg: capacityKg(record),
    });
  }

  summarize(writes, skipped, missing);
  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to apply.');
    return;
  }

  const CHUNK = 400;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + CHUNK)) {
      batch.update(w.ref, { gstBill: w.bill });
    }
    await batch.commit();
    console.log(`Committed ${Math.min(i + CHUNK, writes.length)} / ${writes.length}`);
  }
  console.log(`\nDone. Stored GST bills on ${writes.length} RV record(s).`);
}

async function main() {
  console.log(
    execute
      ? `EXECUTE — store dated RV GST bills (project ${PROJECT_ID})\n`
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
