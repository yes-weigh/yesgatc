/**
 * Corrects rvPaymentAmount on siteCalibrations to per-instrument wallet share.
 * Legacy batch submits stored the session total on every linked record.
 *
 * Dry run (default):
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\path\yesgatc-service-account.json"
 *   npm run backfill:rv-payment-per-record
 *
 * Apply updates:
 *   npm run backfill:rv-payment-per-record -- --execute
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const execute = process.argv.includes('--execute');
const GST_RATE = 0.18;

function initAdmin() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    initializeApp({ credential: cert(json) });
    return;
  }
  initializeApp({ credential: applicationDefault() });
}

function roundInr(value) {
  return Math.round(Number(value) * 100) / 100;
}

function productMaximumCapacityKg(product) {
  if (!product || product.maximumCapacity == null || !Number.isFinite(product.maximumCapacity)) {
    return null;
  }
  if (product.unitOfMeasurement === 'g') {
    return product.maximumCapacity / 1000;
  }
  return product.maximumCapacity;
}

function productForRecord(record, productsById) {
  if (record.productId && productsById.has(record.productId)) {
    return productsById.get(record.productId);
  }
  if (record.maximumCapacity != null) {
    return {
      maximumCapacity: record.maximumCapacity,
      unitOfMeasurement: record.unitOfMeasurement ?? 'kg',
    };
  }
  return null;
}

function tdsFee(product) {
  const capacityKg = productMaximumCapacityKg(product);
  if (capacityKg == null) return 0;
  return capacityKg <= 20 ? 15 : 25;
}

function perDeviceWalletAmount(record, productsById) {
  const product = productForRecord(record, productsById);
  let quotedBase = Number(record.verificationFeeBase);
  if (!Number.isFinite(quotedBase) || quotedBase <= 0) {
    const capacityKg = productMaximumCapacityKg(product);
    if (capacityKg == null) return null;
    quotedBase = capacityKg <= 20 ? 150 : 250;
  }
  const gst = Math.round(quotedBase * GST_RATE);
  return tdsFee(product) + gst;
}

function amountsMatch(a, b) {
  return roundInr(a) === roundInr(b);
}

initAdmin();
const db = getFirestore();

async function main() {
  console.log(
    execute
      ? 'EXECUTE mode — correcting per-record rvPaymentAmount.\n'
      : 'DRY RUN — pass --execute to write.\n',
  );

  const [productsSnap, recordsSnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('siteCalibrations').get(),
  ]);

  const productsById = new Map(productsSnap.docs.map(doc => [doc.id, doc.data()]));
  const updates = [];

  for (const docSnap of recordsSnap.docs) {
    const record = { id: docSnap.id, ...docSnap.data() };
    if (record.verificationType !== 'RV') continue;
    if (record.rvPaymentStatus !== 'paid') continue;

    const stored = Number(record.rvPaymentAmount);
    if (!Number.isFinite(stored) || stored <= 0) continue;

    const computed = perDeviceWalletAmount(record, productsById);
    if (computed == null || computed <= 0) continue;
    if (amountsMatch(stored, computed)) continue;

    updates.push({
      id: docSnap.id,
      applicationNumber: record.applicationNumber ?? '',
      rvPaymentId: record.rvPaymentId ?? '',
      stored,
      computed: roundInr(computed),
    });
  }

  if (updates.length === 0) {
    console.log('No records need rvPaymentAmount correction.');
    return;
  }

  console.log(`Found ${updates.length} record(s) to correct:\n`);
  for (const patch of updates) {
    console.log(
      `  siteCalibrations/${patch.id} (${patch.applicationNumber || 'no app#'}): ${patch.stored} → ${patch.computed} [${patch.rvPaymentId}]`,
    );
  }

  if (!execute) {
    console.log('\nDry run complete. Pass --execute to apply.');
    return;
  }

  const batchSize = 400;
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    const batch = db.batch();
    for (const patch of chunk) {
      batch.update(db.doc(`siteCalibrations/${patch.id}`), {
        rvPaymentAmount: patch.computed,
      });
    }
    await batch.commit();
  }

  console.log(`\nUpdated ${updates.length} record(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
