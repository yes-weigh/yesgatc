import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const snap = await db.collection('siteCalibrations').get();
const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const drafts = records.filter((r) => r.status === 'draft');
console.log('raw draft', drafts.length);

function serialKey(r) {
  const rc = r.rcId?.trim();
  const s = (r.serialNumber || '').trim().toLowerCase();
  return rc && s ? `${rc}|${s}` : null;
}

const groups = new Map();
for (const r of records) {
  const k = serialKey(r);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

function score(r) {
  if (r.status === 'certified' && r.certificateNumber) return 0;
  if (r.status === 'submitted' || r.status === 'approved') return 45;
  if (r.status === 'draft') return 60;
  return 70;
}

function primary(g) {
  return [...g].sort(
    (a, b) =>
      score(a) - score(b) ||
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  )[0];
}

for (const d of drafts) {
  const k = serialKey(d);
  const g = k ? groups.get(k) : [d];
  const p = primary(g);
  console.log({
    serial: d.serialNumber,
    draftId: d.id,
    primaryId: p.id,
    primaryStatus: p.status,
    groupSize: g.length,
  });
}

let collapsedDraft = 0;
for (const g of groups.values()) {
  if (primary(g).status === 'draft') collapsedDraft += 1;
}
console.log('collapsed primaries that are draft', collapsedDraft);

// Simulate matchesVerificationListStatusFilter for draft
let matchDraft = 0;
for (const r of records) {
  const k = serialKey(r);
  const g = k ? groups.get(k) : null;
  const p = g?.length ? primary(g) : r;
  if (p.status === 'draft') matchDraft += 1;
}
console.log('records whose group primary is draft', matchDraft);
