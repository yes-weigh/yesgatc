/**
 * Assigns internal application numbers (VC/26/1, VC/26/2, …) to existing verifications.
 *
 * Oldest record (by createdAt, then document id) receives VC/26/1. Records that already
 * have an application number are left unchanged. The Firestore counter is set so new
 * verifications continue from the next free sequence.
 *
 * Dry run (default):
 *   $env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\path\yesgatc-service-account.json"
 *   npm run backfill:verification-app-numbers
 *
 * Apply updates:
 *   npm run backfill:verification-app-numbers -- --execute
 *
 * Optional:
 *   $env:BACKFILL_SERIES_YEAR="2026"
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const execute = process.argv.includes('--execute');
const SERIES_YEAR = Number(process.env.BACKFILL_SERIES_YEAR ?? '2026');

function initAdmin() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path) {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    initializeApp({ credential: cert(json) });
    return;
  }
  initializeApp({ credential: applicationDefault() });
}

function formatApplicationNumber(calendarYear, sequence) {
  const yy = calendarYear % 100;
  return `VC/${yy}/${sequence}`;
}

function parseApplicationNumber(value) {
  const match = /^VC\/(\d{2})\/(\d+)$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const yy = Number(match[1]);
  const sequence = Number(match[2]);
  if (!Number.isFinite(sequence) || sequence < 1) return null;
  return { calendarYear: 2000 + yy, sequence };
}

function counterDocId(calendarYear) {
  return `verificationApplicationNumber_${calendarYear % 100}`;
}

initAdmin();

const db = getFirestore();

async function main() {
  if (!Number.isFinite(SERIES_YEAR) || SERIES_YEAR < 2000) {
    console.error('BACKFILL_SERIES_YEAR must be a valid calendar year, e.g. 2026.');
    process.exit(1);
  }

  console.log(
    execute
      ? `EXECUTE mode — writing application numbers for ${SERIES_YEAR} series.\n`
      : `DRY RUN — pass --execute to write.\n`,
  );

  const snap = await db.collection('siteCalibrations').get();
  const records = snap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  records.sort((a, b) => {
    const createdDiff = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });

  let maxAssignedSeq = 0;
  for (const record of records) {
    const parsed = parseApplicationNumber(record.applicationNumber);
    if (parsed && parsed.calendarYear === SERIES_YEAR) {
      maxAssignedSeq = Math.max(maxAssignedSeq, parsed.sequence);
    }
  }

  const missing = records.filter(record => !String(record.applicationNumber ?? '').trim());
  let nextSeq = missing.length === records.length ? 1 : maxAssignedSeq + 1;

  const assignments = missing.map(record => {
    const applicationNumber = formatApplicationNumber(SERIES_YEAR, nextSeq);
    const row = { id: record.id, createdAt: record.createdAt ?? '', applicationNumber };
    nextSeq += 1;
    return row;
  });

  const finalNextSeq = nextSeq;

  console.log(`Total verifications: ${records.length}`);
  console.log(`Already numbered (${SERIES_YEAR} series): ${records.length - missing.length}`);
  console.log(`To assign: ${assignments.length}`);
  console.log(`Counter will be set to nextSeq=${finalNextSeq}\n`);

  if (assignments.length === 0) {
    console.log('Nothing to assign.');
    return;
  }

  console.log('Preview (first 10):');
  for (const row of assignments.slice(0, 10)) {
    console.log(`  ${row.applicationNumber}  ${row.createdAt}  ${row.id}`);
  }
  if (assignments.length > 10) {
    console.log(`  … and ${assignments.length - 10} more`);
  }

  if (!execute) {
    console.log('\nNo changes made. Re-run with --execute to apply.');
    return;
  }

  const batchSize = 400;
  for (let index = 0; index < assignments.length; index += batchSize) {
    const batch = db.batch();
    const chunk = assignments.slice(index, index + batchSize);
    for (const row of chunk) {
      batch.update(db.doc(`siteCalibrations/${row.id}`), {
        applicationNumber: row.applicationNumber,
        updatedAt: new Date().toISOString(),
      });
    }
    await batch.commit();
    console.log(`Updated ${Math.min(index + batchSize, assignments.length)} / ${assignments.length}`);
  }

  await db.doc(`_counters/${counterDocId(SERIES_YEAR)}`).set(
    {
      nextSeq: finalNextSeq,
      year: SERIES_YEAR,
      backfilledAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log('\nBackfill complete.');
}

main().catch(err => {
  console.error('\nBackfill failed:', err.message || err);
  console.error('\nSet FIREBASE_SERVICE_ACCOUNT_PATH to your service account JSON file.');
  process.exit(1);
});
