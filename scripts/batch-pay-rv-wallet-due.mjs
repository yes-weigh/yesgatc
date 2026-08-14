/**
 * Pay RC wallet for every non-draft RV with outstanding wallet payment.
 *
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\Users\mhdfa\Downloads\yesgatc-firebase-adminsdk-fbsvc-bb84567811.json"
 *   node scripts/batch-pay-rv-wallet-due.mjs
 *   node scripts/batch-pay-rv-wallet-due.mjs --dry-run
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'yesgatc';
const DRY_RUN = process.argv.includes('--dry-run');
const ACTOR_UID = 'batch-pay-rv-wallet-due';

const DEFAULT_RC_FEES = {
  tierUpto20Kg: { inPremise: 750, inSitu: 850, self: 150 },
  tierUpto150Kg: { inPremise: 900, inSitu: 1000, self: 250 },
};
const RV_TDS_UPTO_20_KG = 15;
const RV_TDS_ABOVE_20_KG = 25;
const GST_RATE = 0.18;

const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
if (!saPath || !existsSync(saPath)) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT_PATH to the admin SDK JSON.');
  process.exit(1);
}

initializeApp({
  credential: cert(JSON.parse(readFileSync(saPath, 'utf8'))),
  projectId: PROJECT_ID,
});

const db = getFirestore();

function roundInr(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeStatus(record) {
  const raw = record.status;
  if (raw === 'submitted' || raw === 'approved' || raw === 'certified' || raw === 'draft' || raw === 'rejected') {
    return raw;
  }
  if (record.certifiedAt) return 'certified';
  if (record.approvedAt) return 'approved';
  if (record.submittedAt) return 'submitted';
  return 'draft';
}

function isOutstanding(record) {
  if (record.verificationType !== 'RV') return false;
  if (record.rvPaymentStatus === 'paid') return false;
  return normalizeStatus(record) !== 'draft';
}

function capacityKg(product, record) {
  const raw = product?.maximumCapacity ?? record.maximumCapacity;
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = product?.unitOfMeasurement || record.unitOfMeasurement || 'kg';
  return unit === 'g' ? n / 1000 : n;
}

function resolveFees(userDoc) {
  const stored = userDoc?.feesStructure;
  if (!stored) return DEFAULT_RC_FEES;
  return {
    tierUpto20Kg: {
      inPremise: stored.tierUpto20Kg?.inPremise ?? DEFAULT_RC_FEES.tierUpto20Kg.inPremise,
      inSitu: stored.tierUpto20Kg?.inSitu ?? DEFAULT_RC_FEES.tierUpto20Kg.inSitu,
      self: stored.tierUpto20Kg?.self ?? DEFAULT_RC_FEES.tierUpto20Kg.self,
    },
    tierUpto150Kg: {
      inPremise: stored.tierUpto150Kg?.inPremise ?? DEFAULT_RC_FEES.tierUpto150Kg.inPremise,
      inSitu: stored.tierUpto150Kg?.inSitu ?? DEFAULT_RC_FEES.tierUpto150Kg.inSitu,
      self: stored.tierUpto150Kg?.self ?? DEFAULT_RC_FEES.tierUpto150Kg.self,
    },
  };
}

function computeBreakdown(record, product, fees) {
  const kg = capacityKg(product, record);
  if (kg == null) return null;
  const selfFee = kg <= 20 ? fees.tierUpto20Kg.self : fees.tierUpto150Kg.self;
  if (!Number.isFinite(selfFee) || selfFee <= 0) return null;
  const gst = Math.round(Math.round(selfFee) * GST_RATE);
  const administrativeFees = kg <= 20 ? RV_TDS_UPTO_20_KG : RV_TDS_ABOVE_20_KG;
  return {
    administrativeFees,
    gst,
    total: administrativeFees + gst,
    tdsTotal: administrativeFees,
    gatewayTotal: 0,
    selfFee,
  };
}

function rcDisplayName(userDoc, rcId) {
  return (
    userDoc?.rcCenterName?.trim()
    || userDoc?.businessName?.trim()
    || userDoc?.displayName?.trim()
    || userDoc?.name?.trim()
    || rcId
  );
}

console.log(DRY_RUN ? 'DRY RUN — no writes' : 'LIVE — will debit wallets and mark paid');

const productsSnap = await db.collection('products').get();
const productsById = new Map(productsSnap.docs.map(d => [d.id, d.data()]));

const rvSnap = await db.collection('siteCalibrations').where('verificationType', '==', 'RV').get();
const outstanding = rvSnap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .filter(isOutstanding);

console.log(`RV records scanned: ${rvSnap.size}`);
console.log(`Payment due: ${outstanding.length}`);

const byRc = new Map();
for (const record of outstanding) {
  const rcId = record.rcId?.trim();
  if (!rcId) {
    console.warn(`SKIP no rcId: ${record.id} serial=${record.serialNumber}`);
    continue;
  }
  if (!byRc.has(rcId)) byRc.set(rcId, []);
  byRc.get(rcId).push(record);
}

const paid = [];
const insufficient = [];
const skipped = [];
const errors = [];

for (const [rcId, records] of byRc) {
  const userSnap = await db.collection('users').doc(rcId).get();
  const userDoc = userSnap.exists ? userSnap.data() : null;
  const fees = resolveFees(userDoc);
  const rcName = rcDisplayName(userDoc, rcId);

  const walletSnap = await db.collection('rcWallets').doc(rcId).get();
  let balance = walletSnap.exists ? Number(walletSnap.data().balanceInr) || 0 : 0;

  // Sort oldest first for deterministic debit order
  records.sort((a, b) => String(a.submittedAt || a.createdAt || '').localeCompare(String(b.submittedAt || b.createdAt || '')));

  for (const record of records) {
    const product = productsById.get(record.productId) || null;
    const breakdown = computeBreakdown(record, product, fees);
    if (!breakdown || breakdown.total <= 0) {
      skipped.push({
        id: record.id,
        serial: record.serialNumber,
        app: record.applicationNumber,
        rcId,
        rcName,
        reason: 'Could not compute wallet amount (missing capacity/product/fees)',
        balance,
      });
      continue;
    }

    const amountInr = roundInr(breakdown.total);
    const label = {
      id: record.id,
      serial: record.serialNumber,
      app: record.applicationNumber || '',
      customer: record.customerName || '',
      status: normalizeStatus(record),
      rcId,
      rcName,
      amountInr,
      balanceBefore: balance,
      breakdown: {
        tds: breakdown.administrativeFees,
        gst: breakdown.gst,
        selfFee: breakdown.selfFee,
      },
    };

    if (balance < amountInr) {
      insufficient.push({ ...label, shortfall: roundInr(amountInr - balance) });
      console.log(
        `INSUFFICIENT  ${rcName}  bal=₹${balance.toFixed(2)}  need=₹${amountInr.toFixed(2)}  ` +
          `serial=${record.serialNumber}  ${record.customerName || ''}`,
      );
      continue;
    }

    if (DRY_RUN) {
      balance = roundInr(balance - amountInr);
      paid.push({ ...label, balanceAfter: balance, dryRun: true });
      console.log(
        `DRY PAY  ${rcName}  ₹${amountInr.toFixed(2)}  serial=${record.serialNumber}  → bal ₹${balance.toFixed(2)}`,
      );
      continue;
    }

    const ledgerId = `rv-${randomUUID()}`;
    const paymentId = `wallet:${ledgerId}`;
    const paidAt = new Date().toISOString();

    try {
      await db.runTransaction(async tx => {
        const wRef = db.collection('rcWallets').doc(rcId);
        const lRef = db.collection('walletLedger').doc(ledgerId);
        const rRef = db.collection('siteCalibrations').doc(record.id);

        const [wSnap, rSnap] = await Promise.all([tx.get(wRef), tx.get(rRef)]);
        if (!rSnap.exists) throw new Error('Record missing');
        const live = rSnap.data();
        if (live.rvPaymentStatus === 'paid') throw new Error('Already paid');
        if (live.verificationType !== 'RV') throw new Error('Not RV');

        const current = wSnap.exists ? Number(wSnap.data().balanceInr) || 0 : 0;
        if (current < amountInr) {
          const err = new Error(
            `Insufficient wallet balance. Available ₹${current.toFixed(2)}, required ₹${amountInr.toFixed(2)}.`,
          );
          err.code = 'insufficient';
          err.current = current;
          throw err;
        }

        const next = roundInr(current - amountInr);
        tx.set(
          wRef,
          { rcId, balanceInr: next, updatedAt: paidAt },
          { merge: true },
        );
        tx.set(lRef, {
          rcId,
          type: 'rv_payment',
          amountInr: -amountInr,
          balanceAfterInr: next,
          recordIds: [record.id],
          status: 'completed',
          idempotencyKey: ledgerId.replace(/^rv-/, ''),
          createdAt: paidAt,
          createdByUid: ACTOR_UID,
          note: 'Batch pay outstanding RV wallet dues (Super Admin script)',
        });
        tx.update(rRef, {
          rvPaymentStatus: 'paid',
          rvPaymentId: paymentId,
          rvPaymentAmount: amountInr,
          rvPaidAt: paidAt,
          updatedAt: paidAt,
        });

        balance = next;
      });

      paid.push({ ...label, balanceAfter: balance, paymentId: `wallet:${ledgerId}` });
      console.log(
        `PAID  ${rcName}  ₹${amountInr.toFixed(2)}  serial=${record.serialNumber}  → bal ₹${balance.toFixed(2)}`,
      );
    } catch (err) {
      if (err.code === 'insufficient') {
        balance = Number(err.current) || balance;
        insufficient.push({ ...label, shortfall: roundInr(amountInr - balance), balanceBefore: balance });
        console.log(
          `INSUFFICIENT  ${rcName}  bal=₹${balance.toFixed(2)}  need=₹${amountInr.toFixed(2)}  serial=${record.serialNumber}`,
        );
      } else if (String(err.message).includes('Already paid')) {
        skipped.push({ ...label, reason: 'Already paid (race)' });
      } else {
        errors.push({ ...label, error: err.message || String(err) });
        console.error(`ERROR  ${record.id}  ${err.message || err}`);
      }
    }
  }
}

console.log('\n======== SUMMARY ========');
console.log(`Paid: ${paid.length}${DRY_RUN ? ' (dry-run)' : ''}`);
console.log(`Insufficient balance: ${insufficient.length}`);
console.log(`Skipped: ${skipped.length}`);
console.log(`Errors: ${errors.length}`);

if (insufficient.length) {
  console.log('\n--- RCs / RVs with insufficient wallet ---');
  const byRcInsuf = new Map();
  for (const row of insufficient) {
    if (!byRcInsuf.has(row.rcId)) {
      byRcInsuf.set(row.rcId, { rcName: row.rcName, balance: row.balanceBefore, items: [] });
    }
    byRcInsuf.get(row.rcId).items.push(row);
  }
  for (const [rcId, group] of byRcInsuf) {
    const need = roundInr(group.items.reduce((s, i) => s + i.amountInr, 0));
    console.log(
      `\n${group.rcName} (${rcId})\n  wallet ≈ ₹${Number(group.balance).toFixed(2)}  unpaid total ₹${need.toFixed(2)}  (${group.items.length} RV)`,
    );
    for (const item of group.items) {
      console.log(
        `  - ${item.serial || '—'}  ${item.app || ''}  ₹${item.amountInr.toFixed(2)}  ${item.customer || ''}  [${item.status}]`,
      );
    }
  }
}

if (paid.length) {
  console.log('\n--- Paid ---');
  for (const row of paid) {
    console.log(
      `  ${row.rcName}  ₹${row.amountInr.toFixed(2)}  ${row.serial}  ${row.customer}`,
    );
  }
}

if (skipped.length) {
  console.log('\n--- Skipped ---');
  for (const row of skipped) {
    console.log(`  ${row.id}  ${row.serial || ''}  ${row.reason}`);
  }
}

if (errors.length) {
  console.log('\n--- Errors ---');
  for (const row of errors) {
    console.log(`  ${row.id}  ${row.error}`);
  }
}
