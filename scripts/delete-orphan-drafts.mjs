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

/** Stale drafts that share RC+serial with an already-certified record. */
const ORPHAN_DRAFT_IDS = [
  'FpbMOvBTbitfkKQ0lvD6', // MG10161 / Meezan
  'V9fKl6PsnqbJmMGT9Bc3', // MG10187 / Meezan
  'deuPPTpvLsuquPsnhKky', // Y09995 / Interweighing
];

for (const id of ORPHAN_DRAFT_IDS) {
  const ref = db.collection('siteCalibrations').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log('skip missing', id);
    continue;
  }
  const data = snap.data() || {};
  if (data.status !== 'draft') {
    console.log('skip non-draft', id, data.status);
    continue;
  }
  await ref.delete();
  console.log('deleted', id, data.serialNumber, data.applicationNumber);
}

const left = await db.collection('siteCalibrations').where('status', '==', 'draft').get();
console.log('drafts remaining', left.size);
for (const d of left.docs) {
  const x = d.data();
  console.log(' remaining', d.id, x.serialNumber, x.applicationNumber);
}
