/**
 * Read serial + certificate number from eMAAP/GATC PDFs, then flag mismatches.
 *
 * Local files:
 *   node scripts/audit-certificate-pdf-serials.mjs 3733.pdf 3734.pdf
 *   node scripts/audit-certificate-pdf-serials.mjs --dir .
 *
 * Firestore PDFs vs stored serial/cert:
 *   node scripts/audit-certificate-pdf-serials.mjs --firestore --today
 *   node scripts/audit-certificate-pdf-serials.mjs --firestore --serials=Y10313,Y10314,RYAL0010,A8063
 *
 * Auth for --firestore: FIREBASE_SERVICE_ACCOUNT_PATH
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const CERT_RE = /Certificate\s*No\.?\s*:?\s*(IND\/GATC\/[A-Z0-9/]+)/i;
const CERT_LOOSE_RE = /IND\/GATC\/KL\/\d{2}\/\d{2}\/\d{2}\/\d+/i;
const YESWEIGH_SERIAL_RE = /\bYESWEIGH\s+([A-Z][A-Z0-9-]*(?:\s+\d{2,})?)\b/;
const TYPE_SERIAL_RE =
  /\b((?:Counter|Platform)\s*Scale|Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z][A-Z0-9-]*(?:\s+\d{2,})?)\s+(20\d{2})\s+(I{1,3}|IV)\b/i;
const LABELED_SERIAL_RE = /Serial\s*Number\s*:?\s*([A-Z][A-Z0-9-]*(?:\s+\d{2,})?)/i;

function argValue(flag) {
  const raw = process.argv.find((a) => a.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1).trim() : '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function norm(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseIdentity(text) {
  const flat = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const certMatch = CERT_RE.exec(flat) || CERT_LOOSE_RE.exec(flat);
  const typeMatch = TYPE_SERIAL_RE.exec(flat);
  const yesMatch = YESWEIGH_SERIAL_RE.exec(flat);
  const labeled = LABELED_SERIAL_RE.exec(flat);

  const serial = [labeled?.[1], typeMatch?.[3], yesMatch?.[1]]
    .map((s) => (s || '').replace(/\s+/g, ' ').trim())
    .find((s) => s && /[0-9]/.test(s)) || '';
  const certificateNumber = (certMatch?.[1] || certMatch?.[0] || '').trim();

  return {
    serialNumber: serial,
    certificateNumber,
    instrumentType: (typeMatch?.[1] || '').trim(),
    manufacturerModel: (typeMatch?.[2] || (yesMatch ? 'YESWEIGH' : '')).trim(),
  };
}

async function extractPdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const pdf = await pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const parts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter((item) => item && typeof item.str === 'string');
    parts.push(items.map((item) => item.str).join(' '));
    const lines = items
      .filter((item) => Array.isArray(item.transform))
      .reduce((map, item) => {
        const key = Math.round((item.transform[5] ?? 0) / 4);
        const row = map.get(key) ?? [];
        row.push(item);
        map.set(key, row);
        return map;
      }, new Map());
    const rowText = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) =>
        row
          .sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
          .map((item) => item.str)
          .join(' '),
      )
      .join('\n');
    if (rowText.trim()) parts.push(rowText);
  }
  return parts.join('\n');
}

async function readPdfIdentity(filePathOrBytes, label) {
  const bytes = Buffer.isBuffer(filePathOrBytes)
    ? filePathOrBytes
    : readFileSync(filePathOrBytes);
  const data = Uint8Array.from(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const text = await extractPdfText(data);
  const identity = parseIdentity(text);
  return { source: label, ...identity, parseOk: Boolean(identity.serialNumber && identity.certificateNumber) };
}

function listPdfArgs() {
  const dir = argValue('--dir');
  const files = process.argv.filter((a) => a.toLowerCase().endsWith('.pdf')).map((a) => resolve(a));
  if (dir) {
    const abs = resolve(dir);
    for (const name of readdirSync(abs)) {
      if (extname(name).toLowerCase() === '.pdf') files.push(join(abs, name));
    }
  }
  return [...new Set(files.filter((p) => existsSync(p) && statSync(p).isFile()))];
}

function printRow(row) {
  const mismatch = row.mismatch ? ' MISMATCH' : '';
  const serial = row.serialNumber || '(no serial)';
  const cert = row.certificateNumber || '(no cert)';
  const extra = row.expectedSerial ? `  firestore=${row.expectedSerial} / ${row.expectedCert || '-'}` : '';
  console.log(`${row.parseOk ? 'OK' : 'FAIL'}${mismatch}  ${serial.padEnd(14)}  ${cert}  ${row.source}${extra}`);
}

async function auditLocal() {
  const files = listPdfArgs();
  if (files.length === 0) {
    console.error('Pass PDF paths or --dir=.');
    process.exit(1);
  }
  const rows = [];
  for (const file of files) {
    const row = await readPdfIdentity(file, basename(file));
    rows.push(row);
    printRow(row);
  }
  const failed = rows.filter((r) => !r.parseOk);
  console.log(`\n${rows.length} PDF(s), ${failed.length} parse fail(s).`);
  return failed.length === 0;
}

async function auditFirestore() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!sa || !existsSync(sa)) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH for --firestore');
  }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(JSON.parse(readFileSync(sa, 'utf8'))) });
  const db = getFirestore();

  const serialFilter = new Set(
    (argValue('--serials') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase()),
  );
  const todayOnly = hasFlag('--today');
  const todayStart = '2026-08-24T00:00:00';

  const snap = await db.collection('siteCalibrations').where('status', '==', 'certified').get();
  const jobs = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const serial = String(d.serialNumber || '').trim();
    const cert = String(d.certificateNumber || '').trim();
    const pdfUrl = String(d.certificatePdfUrl || '').trim();
    const certifiedAt = String(d.certifiedAt || '');
    if (serialFilter.size && !serialFilter.has(serial.toUpperCase())) continue;
    if (todayOnly && certifiedAt < todayStart) continue;
    if (!pdfUrl) continue;
    jobs.push({ id: doc.id, serial, cert, pdfUrl, certifiedAt });
  }

  console.log(`Firestore certified PDFs to read: ${jobs.length}`);
  const mismatches = [];
  const parseFails = [];
  for (const job of jobs) {
    const res = await fetch(job.pdfUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 4).toString() !== '%PDF') {
      parseFails.push({ ...job, reason: `not pdf HTTP ${res.status}` });
      console.log(`FAIL  ${job.serial.padEnd(14)}  ${job.cert}  ${job.id}  (body not PDF)`);
      continue;
    }
    const row = await readPdfIdentity(buf, job.id);
    const serialMismatch = row.serialNumber && norm(row.serialNumber) !== norm(job.serial);
    const certMismatch = row.certificateNumber && norm(row.certificateNumber) !== norm(job.cert);
    const mismatch = Boolean(serialMismatch || certMismatch);
    printRow({
      ...row,
      expectedSerial: job.serial,
      expectedCert: job.cert,
      mismatch,
    });
    if (!row.parseOk) parseFails.push(job);
    if (mismatch) mismatches.push({ job, row, serialMismatch, certMismatch });
  }

  console.log(`\nCompared ${jobs.length}. Parse fail ${parseFails.length}. Serial/cert mismatch ${mismatches.length}.`);
  if (mismatches.length) {
    console.log('\nMismatches:');
    for (const m of mismatches) {
      console.log(
        `  ${m.job.serial} stored ${m.job.cert}  pdf serial=${m.row.serialNumber} cert=${m.row.certificateNumber}  ${m.job.id}`,
      );
    }
  }
  return parseFails.length === 0 && mismatches.length === 0;
}

const firestore = hasFlag('--firestore');
const result = firestore ? await auditFirestore() : await auditLocal();
process.exit(result ? 0 : 2);
