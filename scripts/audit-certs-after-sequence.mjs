/**
 * Audit Firestore certified PDFs with sequence > N (default 2304 = new eMAAP era).
 * Downloads PDFs, extracts serial + cert number, compares to stored fields.
 *
 *   node scripts/audit-certs-after-sequence.mjs
 *   node scripts/audit-certs-after-sequence.mjs --retry-report=%TEMP%/yesgatc-cert-audit-after-2304.json
 *
 * Auth: FIREBASE_SERVICE_ACCOUNT_PATH
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PY = join(ROOT, 'extract-gatc-pdf-identity.py');
const AFTER_SEQ = Number(argValue('--after-seq') || 2304);
const CONCURRENCY = Math.max(1, Number(argValue('--concurrency') || 10));
const BATCH = Math.max(10, Number(argValue('--batch') || 40));
const INCLUDE_FLOOR = true;
const RETRY_REPORT = argValue('--retry-report');
const BUCKETS = ['yesgatc.firebasestorage.app', 'yesgatc.appspot.com'];

function argValue(flag) {
  const raw = process.argv.find((a) => a.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1).trim() : '';
}

function str(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (v._seconds != null) return new Date(v._seconds * 1000).toISOString();
  return String(v).trim();
}

function seqOf(cert) {
  const tail = String(cert || '').trim().split('/').pop() || '';
  if (!/^\d+$/.test(tail)) return null;
  const n = parseInt(tail, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function norm(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function typeKey(t) {
  const u = String(t || '').trim().toUpperCase();
  return u === 'OV' || u === 'RV' ? u : u || '(none)';
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storagePathFromUrl(url) {
  const m = String(url || '').match(/\/o\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function pythonParseOnce(jobs) {
  const spawned = spawnSync('python', [PY], {
    encoding: 'utf8',
    input: JSON.stringify(jobs),
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (spawned.status !== 0) {
    throw new Error(`python parse failed: ${spawned.stderr || spawned.stdout || spawned.status}`);
  }
  return JSON.parse(spawned.stdout);
}

function pythonParse(jobs) {
  try {
    return pythonParseOnce(jobs);
  } catch (err) {
    const out = [];
    for (const job of jobs) {
      try {
        out.push(...pythonParseOnce([job]));
      } catch (inner) {
        out.push({
          id: job.id,
          serialNumber: '',
          certificateNumber: '',
          parseOk: false,
          error: String(inner?.message || inner),
        });
      }
    }
    return out;
  }
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!sa || !existsSync(sa)) {
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH');
}

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getStorage } = await import('firebase-admin/storage');
initializeApp({
  credential: cert(JSON.parse(readFileSync(sa, 'utf8'))),
  storageBucket: BUCKETS[0],
});
const db = getFirestore();
const storage = getStorage();

const snap = await db.collection('siteCalibrations').where('status', '==', 'certified').get();
const all = [];
for (const doc of snap.docs) {
  const d = doc.data();
  const n = seqOf(d.certificateNumber);
  all.push({
    id: doc.id,
    serial: str(d.serialNumber),
    type: str(d.verificationType),
    cert: str(d.certificateNumber),
    seq: n,
    voided: Boolean(str(d.certificateVoidedAt)),
    pdfUrl: str(d.certificatePdfUrl),
    pdfPath: str(d.certificatePdfPath),
    certifiedAt: str(d.certifiedAt),
  });
}

const floor = all.filter((r) => r.seq === AFTER_SEQ);
let jobs = all.filter(
  (r) =>
    !r.voided
    && r.pdfUrl
    && r.seq != null
    && (r.seq > AFTER_SEQ || (INCLUDE_FLOOR && r.seq === AFTER_SEQ)),
);

console.log(`Cert ${AFTER_SEQ}: ${floor.map((r) => `${r.serial} ${r.id}`).join(' | ') || '(none)'}`);
console.log(`PDF audit set (seq>${AFTER_SEQ}${INCLUDE_FLOOR ? ` plus ${AFTER_SEQ}` : ''}, live, has PDF): ${jobs.length}`);

const bySerialType = new Map();
for (const r of jobs.filter((j) => j.seq > AFTER_SEQ)) {
  const key = `${norm(r.serial)}|${typeKey(r.type)}`;
  if (!bySerialType.has(key)) bySerialType.set(key, []);
  bySerialType.get(key).push(r);
}
const dupes = [...bySerialType.values()]
  .filter((list) => list.length > 1)
  .sort((a, b) => b.length - a.length || a[0].serial.localeCompare(b[0].serial));
console.log(`Duplicate serial+type (OV/RV counted separate): ${dupes.length} groups`);

const prevReport = RETRY_REPORT && existsSync(RETRY_REPORT)
  ? JSON.parse(readFileSync(RETRY_REPORT, 'utf8'))
  : null;
if (prevReport) {
  const failIds = new Set((prevReport.parseFails || []).map((f) => f.id));
  const before = jobs.length;
  jobs = jobs.filter((j) => failIds.has(j.id));
  console.log(`Retrying ${jobs.length}/${before} previous parse/download fails from ${RETRY_REPORT}`);
}

async function downloadPdf(job, dest) {
  const path = job.pdfPath || storagePathFromUrl(job.pdfUrl);
  if (path) {
    for (const bucketName of BUCKETS) {
      try {
        await storage.bucket(bucketName).file(path).download({ destination: dest });
        return { ok: true, reason: '' };
      } catch {
        // try next bucket / HTTP fallback
      }
    }
  }

  let last = 'fetch failed';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(job.pdfUrl, { signal: AbortSignal.timeout(60000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok || buf.subarray(0, 4).toString() !== '%PDF') {
        last = `HTTP ${res.status} not PDF`;
      } else {
        writeFileSync(dest, buf);
        return { ok: true, reason: '' };
      }
    } catch (err) {
      last = String(err?.message || err);
    }
    await sleep(600 * (attempt + 1));
  }
  return { ok: false, reason: last };
}

const workDir = mkdtempSync(join(tmpdir(), 'yesgatc-cert-audit-'));
mkdirSync(workDir, { recursive: true });
const mismatches = [];
const parseFails = [];
const okCount = { n: 0 };

try {
  for (let offset = 0; offset < jobs.length; offset += BATCH) {
    const slice = jobs.slice(offset, offset + BATCH);
    const downloaded = await mapPool(slice, CONCURRENCY, async (job) => {
      const dest = join(workDir, `${job.id}.pdf`);
      const got = await downloadPdf(job, dest);
      return { job, dest, ...got };
    });

    const parseJobs = [];
    for (const row of downloaded) {
      if (!row.ok) {
        parseFails.push({ ...row.job, reason: row.reason, pdfSerial: '', pdfCert: '' });
        continue;
      }
      parseJobs.push({ id: row.job.id, path: row.dest });
    }

    if (parseJobs.length) {
      const parsed = pythonParse(parseJobs);
      const byId = new Map(parsed.map((p) => [p.id, p]));
      for (const job of slice) {
        const p = byId.get(job.id);
        if (!p) continue;
        if (!p.parseOk) {
          parseFails.push({
            ...job,
            reason: p.error || 'no serial/cert in PDF',
            pdfSerial: p.serialNumber,
            pdfCert: p.certificateNumber,
          });
          continue;
        }
        const serialMismatch = norm(p.serialNumber) !== norm(job.serial);
        const certMismatch = norm(p.certificateNumber) !== norm(job.cert);
        if (serialMismatch || certMismatch) {
          mismatches.push({
            id: job.id,
            type: job.type,
            storedSerial: job.serial,
            storedCert: job.cert,
            pdfSerial: p.serialNumber,
            pdfCert: p.certificateNumber,
            serialMismatch,
            certMismatch,
            seq: job.seq,
          });
        } else {
          okCount.n += 1;
        }
      }
    }

    for (const row of downloaded) {
      try {
        rmSync(row.dest, { force: true });
      } catch {
        // ignore
      }
    }

    const done = Math.min(offset + slice.length, jobs.length);
    console.log(`… ${done}/${jobs.length}  ok=${okCount.n}  mismatch=${mismatches.length}  parseFail=${parseFails.length}`);
    await sleep(150);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const retriedIds = new Set(jobs.map((j) => j.id));
const mergedMismatches = prevReport
  ? [...(prevReport.mismatches || []).filter((m) => !retriedIds.has(m.id)), ...mismatches]
  : mismatches;
const mergedParseFails = prevReport
  ? [...(prevReport.parseFails || []).filter((f) => !retriedIds.has(f.id)), ...parseFails]
  : parseFails;
const mergedOk = prevReport ? (prevReport.pdfSerialMatches || 0) + okCount.n : okCount.n;
const mergedAudited = prevReport?.audited || jobs.length;

const report = {
  queriedAt: new Date().toISOString(),
  afterSeq: AFTER_SEQ,
  floor,
  audited: mergedAudited,
  pdfSerialMatches: mergedOk,
  mismatches: mergedMismatches,
  parseFails: mergedParseFails,
  duplicateSerialTypeGroups: dupes.map((list) => ({
    serial: list[0].serial,
    type: list[0].type,
    count: list.length,
    certs: list.map((r) => r.cert).sort(),
    ids: list.map((r) => r.id),
  })),
};

const outPath = join(tmpdir(), `yesgatc-cert-audit-after-${AFTER_SEQ}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nPDF serial matches: ${mergedOk}/${mergedAudited}`);
console.log(`Serial/cert mismatches: ${mergedMismatches.length}`);
console.log(`Parse/download fails: ${mergedParseFails.length}`);
console.log(`Duplicate serial+type groups: ${dupes.length}`);
console.log(`Report: ${outPath}`);
if (mergedMismatches.length) {
  console.log('\nMismatches:');
  for (const m of mergedMismatches.slice(0, 80)) {
    console.log(
      `  ${m.storedSerial} (${m.type}) stored ${m.storedCert}  pdf ${m.pdfSerial} / ${m.pdfCert}  ${m.id}`,
    );
  }
  if (mergedMismatches.length > 80) console.log(`  … ${mergedMismatches.length - 80} more`);
}
if (mergedParseFails.length) {
  console.log('\nParse/download fails:');
  for (const f of mergedParseFails.slice(0, 40)) {
    console.log(`  ${f.serial} ${f.cert}  ${f.reason}  ${f.id}`);
  }
}

process.exit(mergedMismatches.length || mergedParseFails.length ? 2 : 0);
