/**
 * Upload eMAAP certificate PDFs and mark matching siteCalibrations certified.
 *
 * Default: Meezan RC, status submitted.
 *
 * Dry run:
 *   node scripts/import-emaap-pdfs-mark-certified.mjs --pdfs="/Users/mac/Desktop/Meezan-emaap-pdfs"
 *
 * Apply:
 *   node scripts/import-emaap-pdfs-mark-certified.mjs --pdfs="..." --execute
 *
 * Match order: filename contains serial, then PDF text contains serial, then certificate number.
 *
 * Auth: FIREBASE_SERVICE_ACCOUNT_PATH, GOOGLE_APPLICATION_CREDENTIALS, or gcloud user token.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const execute = process.argv.includes('--execute');
const PROJECT_ID =
  process.env.GCLOUD_PROJECT?.trim() ||
  process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
  'yesgatc';
const BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET?.trim() || 'yesgatc.firebasestorage.app';
const RC_NAME = argValue('--rc') || 'Meezan';
const PDF_DIR = resolve(argValue('--pdfs') || join(process.env.HOME || '', 'Desktop', 'Meezan-emaap-pdfs'));
const CERT_RE = /IND\/GATC\/[A-Z0-9/._-]+/gi;

function argValue(flag) {
  const raw = process.argv.find(a => a.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1).trim() : '';
}

function gcloudAccessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function tryInitAdminSdk() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (path && existsSync(path)) {
    initializeApp({
      credential: cert(JSON.parse(readFileSync(path, 'utf8'))),
      projectId: PROJECT_ID,
      storageBucket: BUCKET,
    });
    console.log(`Auth: service account (${path})`);
    return true;
  }
  const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (adc && existsSync(adc)) {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: BUCKET,
    });
    console.log('Auth: GOOGLE_APPLICATION_CREDENTIALS');
    return true;
  }
  try {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: BUCKET,
    });
    console.log('Auth: applicationDefault');
    return true;
  } catch {
    return false;
  }
}

function norm(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function extractPdfStrings(buf) {
  const latin = buf.toString('latin1');
  const hits = [];
  const cert = latin.match(CERT_RE) || [];
  hits.push(...cert.map(s => s.trim()));
  const serialish = latin.match(/\b[A-Z]{2,}\d{3,}[A-Z0-9-]*\b/g) || [];
  hits.push(...serialish);
  return [...new Set(hits)];
}

function listPdfs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  return readdirSync(dir)
    .filter(name => extname(name).toLowerCase() === '.pdf')
    .map(name => join(dir, name));
}

async function main() {
  if (!tryInitAdminSdk()) {
    const token = gcloudAccessToken();
    if (!token) {
      console.error('Need FIREBASE_SERVICE_ACCOUNT_PATH or gcloud auth.');
      process.exit(1);
    }
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
      storageBucket: BUCKET,
    });
    console.log('Auth: gcloud ADC');
  }

  const db = getFirestore();
  const users = await db.collection('users').get();
  const rcs = users.docs.filter(d => {
    const data = d.data();
    if (String(data.role || '') !== 'rc_admin') return false;
    const blob = `${data.displayName || ''} ${data.name || ''} ${data.companyName || ''} ${data.rcName || ''} ${data.laboratoryName || ''}`;
    return blob.toLowerCase().includes(RC_NAME.toLowerCase());
  });

  if (rcs.length === 0) {
    console.error(`No RC admin matching "${RC_NAME}".`);
    process.exit(1);
  }

  console.log(
    'RC matches:\n' +
      rcs
        .map(d => {
          const data = d.data();
          return `  ${d.id}  ${data.displayName || data.name || data.companyName || ''}`;
        })
        .join('\n'),
  );

  const rcIds = new Set(rcs.map(d => d.id));
  const snap = await db.collection('siteCalibrations').where('status', '==', 'submitted').get();
  const jobs = snap.docs
    .filter(d => rcIds.has(String(d.data().rcId || '')))
    .map(d => {
      const data = d.data();
      return {
        id: d.id,
        serial: String(data.serialNumber || '').trim(),
        customer: String(data.customerName || '').trim(),
        applicationNumber: String(data.applicationNumber || '').trim(),
        rcId: String(data.rcId || ''),
      };
    });

  console.log(`\nSubmitted jobs for ${RC_NAME}: ${jobs.length}`);
  for (const job of jobs) {
    console.log(`  ${job.serial.padEnd(16)} ${job.customer}  ${job.id}`);
  }

  const pdfs = listPdfs(PDF_DIR);
  console.log(`\nPDF folder: ${PDF_DIR}`);
  console.log(`PDFs found: ${pdfs.length}`);
  if (pdfs.length === 0) {
    console.log('\nPut downloaded eMAAP PDFs in that folder (name can include serial). Re-run.');
    process.exit(0);
  }

  const usedPdf = new Set();
  const usedJob = new Set();
  const matches = [];

  for (const pdfPath of pdfs) {
    const file = basename(pdfPath);
    const buf = readFileSync(pdfPath);
    const tokens = extractPdfStrings(buf);
    const fileNorm = norm(file);
    let job =
      jobs.find(j => j.serial && fileNorm.includes(norm(j.serial))) ||
      jobs.find(j => j.serial && tokens.some(t => norm(t) === norm(j.serial) || norm(t).includes(norm(j.serial))));
    if (!job) {
      const cert = (tokens.find(t => /IND\/GATC\//i.test(t)) || '').trim();
      if (cert) {
        job = jobs.find(j => fileNorm.includes(norm(cert.replace(/\//g, ''))));
      }
    }
    if (!job || usedJob.has(job.id)) {
      console.log(`UNMATCHED  ${file}`);
      continue;
    }
    const certNo = (tokens.find(t => /IND\/GATC\//i.test(t)) || '').replace(/[.,;]+$/, '').trim();
    usedPdf.add(pdfPath);
    usedJob.add(job.id);
    matches.push({ job, pdfPath, file, certNo });
  }

  console.log(`\nMatched: ${matches.length}`);
  for (const row of matches) {
    console.log(`  ${row.job.serial}  ←  ${row.file}  ${row.certNo || '(no cert no parsed)'}`);
  }

  const unmatchedJobs = jobs.filter(j => !usedJob.has(j.id));
  if (unmatchedJobs.length) {
    console.log('\nStill submitted (no PDF match):');
    for (const j of unmatchedJobs) {
      console.log(`  ${j.serial}  ${j.customer}`);
    }
  }

  if (!execute) {
    console.log('\nDry run. Add --execute to upload PDFs and set status=certified.');
    return;
  }

  const bucket = getStorage().bucket(BUCKET);
  const now = new Date().toISOString();
  for (const row of matches) {
    const stamp = Math.floor(Date.now() / 1000);
    const safeName = basename(row.pdfPath).replace(/[^\w.\-]+/g, '_');
    const storagePath = `siteCalibrations/${row.job.id}/certificate-pdf/${stamp}_${safeName}`;
    const [file] = await bucket.upload(row.pdfPath, {
      destination: storagePath,
      metadata: {
        contentType: 'application/pdf',
        metadata: { firebaseStorageDownloadTokens: createHash('sha256').update(storagePath).digest('hex').slice(0, 32) },
      },
    });
    const token = file.metadata?.metadata?.firebaseStorageDownloadTokens;
    const encoded = encodeURIComponent(storagePath);
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encoded}?alt=media&token=${token}`;
    const patch = {
      status: 'certified',
      certifiedAt: now,
      updatedAt: now,
      certificatePdfUrl: downloadUrl,
      certificatePdfPath: storagePath,
      certificatePdfName: safeName,
      certificatePdfContentType: 'application/pdf',
      pipelineFailedPhase: FieldValue.delete(),
      pipelineFailureMessage: FieldValue.delete(),
      pipelineFailedAt: FieldValue.delete(),
      certificationLastError: FieldValue.delete(),
    };
    if (row.certNo) {
      patch.certificateNumber = row.certNo;
    }
    await db.collection('siteCalibrations').doc(row.job.id).update(patch);
    console.log(`CERTIFIED  ${row.job.serial}  ${row.job.id}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
