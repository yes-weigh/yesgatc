/**
 * Removes historical RV payment gateway fees from wallet ledger and verification records.
 *
 * Gateway was ₹1 (≤20 kg) or ₹2 (>20 kg) per device, included in administrativeFees + GST payments.
 *
 * Dry run (default):
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\path\yesgatc-service-account.json"
 *   npm run backfill:remove-rv-gateway-fees
 *
 * Apply updates:
 *   npm run backfill:remove-rv-gateway-fees -- --execute
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const execute = process.argv.includes('--execute');

const LEGACY_GATEWAY_UPTO_20_KG = 1;
const LEGACY_GATEWAY_ABOVE_20_KG = 2;
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

function legacyGatewayFee(product) {
  const capacityKg = productMaximumCapacityKg(product);
  if (capacityKg == null) return 0;
  return capacityKg <= 20 ? LEGACY_GATEWAY_UPTO_20_KG : LEGACY_GATEWAY_ABOVE_20_KG;
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

function legacyGatewayForRecord(record, productsById) {
  return legacyGatewayFee(productForRecord(record, productsById));
}

function verificationFeeWithGst(baseAmount) {
  const base = Math.max(0, Number(baseAmount) || 0);
  const gst = Math.round(base * GST_RATE);
  return { base, gst, total: base + gst };
}

function legacyTdsFee(product) {
  const capacityKg = productMaximumCapacityKg(product);
  if (capacityKg == null) return 0;
  return capacityKg <= 20 ? 15 : 25;
}

function legacyPaymentTotalForRecord(record, productsById) {
  const product = productForRecord(record, productsById);
  const quotedBase = Number(record.verificationFeeBase);
  if (!Number.isFinite(quotedBase) || quotedBase <= 0) return null;

  const tds = legacyTdsFee(product);
  const gateway = legacyGatewayFee(product);
  const { gst } = verificationFeeWithGst(quotedBase);
  return tds + gateway + gst;
}

function correctedPaymentTotalForRecord(record, productsById) {
  const product = productForRecord(record, productsById);
  const quotedBase = Number(record.verificationFeeBase);
  if (!Number.isFinite(quotedBase) || quotedBase <= 0) return null;

  const tds = legacyTdsFee(product);
  const { gst } = verificationFeeWithGst(quotedBase);
  return tds + gst;
}

initAdmin();

const db = getFirestore();

async function main() {
  console.log(
    execute
      ? 'EXECUTE mode — correcting historical RV gateway fees.\n'
      : 'DRY RUN — pass --execute to write.\n',
  );

  const [productsSnap, ledgerSnap, recordsSnap, rvPaymentsSnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('walletLedger').get(),
    db.collection('siteCalibrations').get(),
    db.collection('rvPayments').get(),
  ]);

  const productsById = new Map(productsSnap.docs.map(doc => [doc.id, doc.data()]));
  const recordsById = new Map(recordsSnap.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));

  const ledgerUpdates = new Map();
  const recordUpdates = new Map();
  const rvPaymentUpdates = new Map();

  const recordsByWalletPaymentId = new Map();
  for (const [id, record] of recordsById) {
    const paymentId = typeof record.rvPaymentId === 'string' ? record.rvPaymentId.trim() : '';
    if (!paymentId.startsWith('wallet:')) continue;
    const ledgerId = paymentId.slice('wallet:'.length);
    const bucket = recordsByWalletPaymentId.get(ledgerId) ?? [];
    bucket.push(id);
    recordsByWalletPaymentId.set(ledgerId, bucket);
  }

  for (const docSnap of ledgerSnap.docs) {
    const entry = docSnap.data();
    if (entry.type !== 'rv_payment' || entry.status !== 'completed') continue;

    const recordIds = Array.isArray(entry.recordIds)
      ? entry.recordIds.filter(id => typeof id === 'string' && id.trim())
      : [];
    const linkedRecordIds =
      recordIds.length > 0 ? recordIds : (recordsByWalletPaymentId.get(docSnap.id) ?? []);
    if (linkedRecordIds.length === 0) {
      console.warn(`  skip ledger ${docSnap.id}: no linked verification records`);
      continue;
    }

    const gatewayReduction = linkedRecordIds.reduce((sum, recordId) => {
      const record = recordsById.get(recordId);
      return sum + (record ? legacyGatewayForRecord(record, productsById) : 0);
    }, 0);

    if (gatewayReduction <= 0) continue;

    const oldDebit = Math.abs(Number(entry.amountInr) || 0);
    const newDebit = roundInr(oldDebit - gatewayReduction);
    if (newDebit <= 0 || newDebit >= oldDebit) continue;

    ledgerUpdates.set(docSnap.id, {
      rcId: entry.rcId,
      oldAmountInr: entry.amountInr,
      newAmountInr: -newDebit,
      gatewayReduction,
      recordIds: linkedRecordIds,
    });
  }

  for (const [id, record] of recordsById) {
    if (record.verificationType !== 'RV' || record.rvPaymentStatus !== 'paid') continue;
    const currentAmount = Number(record.rvPaymentAmount);
    if (!Number.isFinite(currentAmount) || currentAmount <= 0) continue;

    const legacyTotal = legacyPaymentTotalForRecord(record, productsById);
    const correctedTotal = correctedPaymentTotalForRecord(record, productsById);
    if (legacyTotal == null || correctedTotal == null) continue;

    if (roundInr(currentAmount) !== roundInr(legacyTotal)) continue;
    if (roundInr(correctedTotal) >= roundInr(legacyTotal)) continue;

    recordUpdates.set(id, {
      oldRvPaymentAmount: currentAmount,
      newRvPaymentAmount: correctedTotal,
      gatewayReduction: roundInr(legacyTotal - correctedTotal),
    });
  }

  for (const docSnap of rvPaymentsSnap.docs) {
    const payment = docSnap.data();
    if (payment.paymentType === 'admin_gateway_test') continue;
    const currentAmount = Number(payment.amountInr);
    if (!Number.isFinite(currentAmount) || currentAmount <= 0) continue;

    const recordIds = Array.isArray(payment.recordIds)
      ? payment.recordIds.filter(id => typeof id === 'string' && id.trim())
      : [];
    if (recordIds.length === 0) continue;

    const gatewayReduction = recordIds.reduce((sum, recordId) => {
      const record = recordsById.get(recordId);
      return sum + (record ? legacyGatewayForRecord(record, productsById) : 0);
    }, 0);
    if (gatewayReduction <= 0) continue;

    const newAmount = roundInr(currentAmount - gatewayReduction);
    if (newAmount <= 0 || newAmount >= currentAmount) continue;

    rvPaymentUpdates.set(docSnap.id, {
      oldAmountInr: currentAmount,
      newAmountInr: newAmount,
      gatewayReduction,
    });
  }

  const rcIds = new Set([
    ...[...ledgerUpdates.values()].map(entry => entry.rcId).filter(Boolean),
  ]);

  const walletBalanceUpdates = new Map();

  for (const rcId of rcIds) {
    const rcLedger = ledgerSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(entry => entry.rcId === rcId)
      .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

    let runningBalance = 0;
    const recomputed = [];

    for (const entry of rcLedger) {
      const patch = ledgerUpdates.get(entry.id);
      const amountInr = patch ? patch.newAmountInr : Number(entry.amountInr) || 0;
      runningBalance = roundInr(runningBalance + amountInr);
      const storedBalance = roundInr(Number(entry.balanceAfterInr) || 0);
      recomputed.push({
        id: entry.id,
        amountInr,
        balanceAfterInr: runningBalance,
        amountPatched: Boolean(patch),
        balanceChanged: storedBalance !== runningBalance,
      });
    }

    const walletSnap = await db.doc(`rcWallets/${rcId}`).get();
    const currentWalletBalance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;
    const finalBalance = runningBalance;

    walletBalanceUpdates.set(rcId, {
      currentWalletBalance,
      finalBalance,
      delta: roundInr(finalBalance - currentWalletBalance),
      ledgerRows: recomputed,
    });
  }

  console.log(`Ledger rows to patch: ${ledgerUpdates.size}`);
  for (const [id, patch] of ledgerUpdates) {
    console.log(
      `  walletLedger/${id}: ${patch.oldAmountInr} → ${patch.newAmountInr} (−₹${patch.gatewayReduction} gateway)`,
    );
  }

  console.log(`\nVerification records to patch: ${recordUpdates.size}`);
  for (const [id, patch] of recordUpdates) {
    console.log(
      `  siteCalibrations/${id}: rvPaymentAmount ${patch.oldRvPaymentAmount} → ${patch.newRvPaymentAmount}`,
    );
  }

  console.log(`\nRazorpay rvPayments to patch: ${rvPaymentUpdates.size}`);
  for (const [id, patch] of rvPaymentUpdates) {
    console.log(`  rvPayments/${id}: ${patch.oldAmountInr} → ${patch.newAmountInr}`);
  }

  console.log(`\nWallet balances to recompute: ${walletBalanceUpdates.size}`);
  for (const [rcId, patch] of walletBalanceUpdates) {
    console.log(
      `  rcWallets/${rcId}: ${patch.currentWalletBalance} → ${patch.finalBalance} (Δ ${patch.delta >= 0 ? '+' : ''}${patch.delta})`,
    );
  }

  if (!execute) {
    console.log('\nDry run complete. Re-run with --execute to apply.');
    return;
  }

  let batch = db.batch();
  let batchOps = 0;

  async function commitBatch() {
    if (batchOps === 0) return;
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  }

  for (const [, walletPatch] of walletBalanceUpdates) {
    for (const row of walletPatch.ledgerRows) {
      if (!row.amountPatched && !row.balanceChanged) continue;
      const update = { balanceAfterInr: row.balanceAfterInr };
      if (row.amountPatched) {
        update.amountInr = row.amountInr;
        update.gatewayFeeRemovedAt = new Date().toISOString();
      }
      batch.update(db.doc(`walletLedger/${row.id}`), update);
      batchOps += 1;
      if (batchOps >= 400) await commitBatch();
    }
  }

  for (const [rcId, walletPatch] of walletBalanceUpdates) {
    batch.set(
      db.doc(`rcWallets/${rcId}`),
      {
        rcId,
        balanceInr: walletPatch.finalBalance,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    batchOps += 1;
    if (batchOps >= 400) await commitBatch();
  }

  for (const [id, patch] of recordUpdates) {
    batch.update(db.doc(`siteCalibrations/${id}`), {
      rvPaymentAmount: patch.newRvPaymentAmount,
      gatewayFeeRemovedAt: new Date().toISOString(),
    });
    batchOps += 1;
    if (batchOps >= 400) await commitBatch();
  }

  for (const [id, patch] of rvPaymentUpdates) {
    batch.update(db.doc(`rvPayments/${id}`), {
      amountInr: patch.newAmountInr,
      amountPaise: Math.round(patch.newAmountInr * 100),
      gatewayFeeRemovedAt: new Date().toISOString(),
    });
    batchOps += 1;
    if (batchOps >= 400) await commitBatch();
  }

  await commitBatch();
  console.log('\nBackfill applied.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
