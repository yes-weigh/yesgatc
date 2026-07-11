/**
 * Compare siteCalibrations: pipelineFailedPhase=submit vs certified samples.
 * Usage:
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\Users\mhdfa\Downloads\yesgatc-firebase-adminsdk-fbsvc-bb84567811.json"
 *   node scripts/compare-failed-submit-vs-certified.mjs
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
if (!path) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT_PATH');
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(path, 'utf8'))) });
const db = getFirestore();

const IMAGE_KEYS = [
  'stampingImageUrl', 'stampingImagePath',
  'scaleImageUrl', 'scaleImagePath',
  'instrumentRearImageUrl', 'instrumentRearImagePath',
  'standardWeightImageUrl', 'standardWeightImagePath',
  'verificationSealImageUrl', 'verificationSealImagePath',
  'installationImageUrl', 'installationImagePath',
];

function hasUrl(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return Boolean(s) && !s.startsWith('blob:');
}

function imageSummary(data) {
  const present = [];
  const missing = [];
  for (const key of IMAGE_KEYS) {
    if (key.endsWith('Path')) continue;
    const urlKey = key;
    const pathKey = key.replace('Url', 'Path');
    const ok = hasUrl(data[urlKey]) || hasUrl(data[pathKey]);
    const label = urlKey.replace('ImageUrl', '');
    if (ok) present.push(label);
    else missing.push(label);
  }
  return { present, missing, presentCount: present.length, missingCount: missing.length };
}

function pick(data, id) {
  const img = imageSummary(data);
  return {
    id,
    status: data.status ?? null,
    verificationType: data.verificationType ?? null,
    customerName: data.customerName ?? null,
    serialNumber: data.serialNumber ?? null,
    applicationNumber: data.applicationNumber ?? null,
    certificateNumber: data.certificateNumber ?? null,
    performedBy: data.performedBy ?? null,
    vctName: data.vctName ?? null,
    rcId: data.rcId ?? null,
    createdByUid: data.createdByUid ?? null,
    submittedAt: data.submittedAt ?? null,
    approvedAt: data.approvedAt ?? null,
    certifiedAt: data.certifiedAt ?? null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    pipelineFailedPhase: data.pipelineFailedPhase ?? null,
    pipelineFailureMessage: data.pipelineFailureMessage ?? null,
    pipelineFailedAt: data.pipelineFailedAt ?? null,
    certificationLastError: data.certificationLastError ?? null,
    pincode: data.pincode ?? null,
    ambientTemperature: data.ambientTemperature ?? null,
    relativeHumidity: data.relativeHumidity ?? null,
    verificationLocation: data.verificationLocation ?? null,
    verificationSubject: data.verificationSubject ?? null,
    productId: data.productId ?? null,
    sealIdentificationNumber: data.sealIdentificationNumber ?? null,
    imagePresentCount: img.presentCount,
    imageMissing: img.missing,
    hasCertificatePdf: hasUrl(data.certificatePdfUrl) || hasUrl(data.certificatePdfPath),
    applicationNumberProvisional: data.applicationNumberProvisional ?? null,
  };
}

function fieldPresenceStats(rows, field) {
  let present = 0;
  for (const r of rows) {
    const v = r[field];
    if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) present += 1;
  }
  return `${present}/${rows.length}`;
}

async function main() {
  console.log('Querying failed-at-submit (pipelineFailedPhase == submit)...\n');
  const failedSnap = await db.collection('siteCalibrations')
    .where('pipelineFailedPhase', '==', 'submit')
    .get();

  const failed = failedSnap.docs.map(d => pick(d.data(), d.id));
  console.log(`Failed at submit count: ${failed.length}`);

  // Prefer Meezan / Victory from screenshot; else all
  const focusSerials = new Set(['MG10169', 'MG10173', 'MG10136', 'YZB76934', 'YZB76933']);
  const failedFocus = failed.filter(r => focusSerials.has(r.serialNumber));
  const failedSample = failedFocus.length ? failedFocus : failed.slice(0, 8);

  console.log('\n=== FAILED AT SUBMIT (detail) ===');
  for (const r of failedSample) {
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }

  // Message frequency across all failed
  const msgCounts = new Map();
  for (const r of failed) {
    const msg = (r.pipelineFailureMessage || '(empty)').slice(0, 200);
    msgCounts.set(msg, (msgCounts.get(msg) ?? 0) + 1);
  }
  console.log('\n=== FAILURE MESSAGE FREQUENCY ===');
  for (const [msg, n] of [...msgCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${n}x  ${msg}`);
  }

  console.log('\nQuerying certified samples (status == certified, limit via recent)...\n');
  // Firestore may need composite index for orderBy+where; fetch certified without order then sort
  const certifiedSnap = await db.collection('siteCalibrations')
    .where('status', '==', 'certified')
    .limit(40)
    .get();

  let certified = certifiedSnap.docs.map(d => pick(d.data(), d.id));
  certified.sort((a, b) => String(b.certifiedAt || b.updatedAt || '').localeCompare(String(a.certifiedAt || a.updatedAt || '')));
  certified = certified.slice(0, 8);

  // Also try OV certified from same RCs as failed if possible
  const failedRcIds = [...new Set(failedSample.map(r => r.rcId).filter(Boolean))];
  const sameRcCertified = [];
  for (const rcId of failedRcIds.slice(0, 2)) {
    const snap = await db.collection('siteCalibrations')
      .where('rcId', '==', rcId)
      .where('status', '==', 'certified')
      .limit(5)
      .get();
    for (const d of snap.docs) sameRcCertified.push(pick(d.data(), d.id));
  }

  console.log('\n=== CERTIFIED SAMPLE (global) ===');
  for (const r of certified.slice(0, 3)) {
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }

  if (sameRcCertified.length) {
    console.log('\n=== CERTIFIED SAME RC AS FAILED ===');
    for (const r of sameRcCertified.slice(0, 4)) {
      console.log(JSON.stringify(r, null, 2));
      console.log('---');
    }
  }

  const compareFields = [
    'status', 'pipelineFailedPhase', 'pipelineFailureMessage', 'certificateNumber',
    'hasCertificatePdf', 'imagePresentCount', 'ambientTemperature', 'relativeHumidity',
    'sealIdentificationNumber', 'productId', 'verificationLocation', 'verificationSubject',
    'submittedAt', 'approvedAt', 'certifiedAt', 'applicationNumber', 'pincode',
  ];

  console.log('\n=== FIELD PRESENCE: FAILED vs CERTIFIED (same-RC preferred) ===');
  const certCompare = sameRcCertified.length ? sameRcCertified : certified;
  console.log('field'.padEnd(28), 'failed', 'certified');
  for (const f of compareFields) {
    console.log(
      f.padEnd(28),
      fieldPresenceStats(failedSample, f).padEnd(10),
      fieldPresenceStats(certCompare, f),
    );
  }

  console.log('\n=== IMAGE MISSING COUNTS (failed sample) ===');
  const missMap = new Map();
  for (const r of failedSample) {
    for (const m of r.imageMissing) missMap.set(m, (missMap.get(m) ?? 0) + 1);
  }
  for (const [k, n] of [...missMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${n}/${failedSample.length} missing ${k}`);
  }

  console.log('\n=== IMAGE MISSING COUNTS (certified compare) ===');
  const missMapC = new Map();
  for (const r of certCompare) {
    for (const m of r.imageMissing) missMapC.set(m, (missMapC.get(m) ?? 0) + 1);
  }
  if (missMapC.size === 0) console.log('(none missing among required image url/path pairs)');
  for (const [k, n] of [...missMapC.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${n}/${certCompare.length} missing ${k}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
