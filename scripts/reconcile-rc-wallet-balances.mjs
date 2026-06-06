/**
 * Recomputes walletLedger.balanceAfterInr and rcWallets.balanceInr from ledger history.
 *
 * Dry run (default):
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\path\yesgatc-service-account.json"
 *   npm run reconcile:rc-wallet-balances
 *
 * Apply:
 *   npm run reconcile:rc-wallet-balances -- --execute
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const execute = process.argv.includes('--execute');

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

function ledgerDelta(entry) {
  if (entry.type === 'rv_payment' && entry.status === 'refunded') {
    return 0;
  }
  return Number(entry.amountInr) || 0;
}

function sortLedgerEntries(entries) {
  return [...entries].sort((a, b) => {
    const timeDiff = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    if (timeDiff !== 0) return timeDiff;
    return String(a.id).localeCompare(String(b.id));
  });
}

initAdmin();

const db = getFirestore();

async function main() {
  console.log(
    execute
      ? 'EXECUTE mode — reconciling RC wallet balances.\n'
      : 'DRY RUN — pass --execute to write.\n',
  );

  const ledgerSnap = await db.collection('walletLedger').get();
  const entries = ledgerSnap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  const byRcId = new Map();
  for (const entry of entries) {
    const rcId = entry.rcId;
    if (!rcId) continue;
    const bucket = byRcId.get(rcId) ?? [];
    bucket.push(entry);
    byRcId.set(rcId, bucket);
  }

  const ledgerPatches = [];
  const walletPatches = [];

  for (const [rcId, rcEntries] of byRcId) {
    const ordered = sortLedgerEntries(rcEntries);
    let runningBalance = 0;

    for (const entry of ordered) {
      runningBalance = roundInr(runningBalance + ledgerDelta(entry));
      const storedBalance = roundInr(Number(entry.balanceAfterInr) || 0);
      if (storedBalance !== runningBalance) {
        ledgerPatches.push({
          id: entry.id,
          rcId,
          type: entry.type,
          amountInr: entry.amountInr,
          storedBalance,
          runningBalance,
        });
      }
    }

    const walletSnap = await db.doc(`rcWallets/${rcId}`).get();
    const storedWalletBalance = walletSnap.exists
      ? roundInr(Number(walletSnap.data().balanceInr) || 0)
      : 0;

    if (storedWalletBalance !== runningBalance) {
      walletPatches.push({
        rcId,
        storedWalletBalance,
        runningBalance,
        delta: roundInr(runningBalance - storedWalletBalance),
      });
    }
  }

  console.log(`RC centres with ledger: ${byRcId.size}`);
  console.log(`Ledger rows to fix: ${ledgerPatches.length}`);
  for (const patch of ledgerPatches) {
    console.log(
      `  walletLedger/${patch.id} (${patch.rcId}, ${patch.type}): balance ${patch.storedBalance} → ${patch.runningBalance}`,
    );
  }

  console.log(`\nWallet docs to fix: ${walletPatches.length}`);
  for (const patch of walletPatches) {
    console.log(
      `  rcWallets/${patch.rcId}: ${patch.storedWalletBalance} → ${patch.runningBalance} (Δ ${patch.delta >= 0 ? '+' : ''}${patch.delta})`,
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

  const reconciledAt = new Date().toISOString();

  for (const patch of ledgerPatches) {
    batch.update(db.doc(`walletLedger/${patch.id}`), {
      balanceAfterInr: patch.runningBalance,
      balanceReconciledAt: reconciledAt,
    });
    batchOps += 1;
    if (batchOps >= 400) await commitBatch();
  }

  for (const patch of walletPatches) {
    batch.set(
      db.doc(`rcWallets/${patch.rcId}`),
      {
        rcId: patch.rcId,
        balanceInr: patch.runningBalance,
        updatedAt: reconciledAt,
        balanceReconciledAt: reconciledAt,
      },
      { merge: true },
    );
    batchOps += 1;
    if (batchOps >= 400) await commitBatch();
  }

  await commitBatch();
  console.log('\nReconciliation applied.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
