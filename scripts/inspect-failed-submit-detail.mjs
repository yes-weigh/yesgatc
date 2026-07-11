import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
initializeApp({ credential: cert(JSON.parse(readFileSync(path, 'utf8'))) });
const db = getFirestore();

const failed = await db.collection('siteCalibrations')
  .where('pipelineFailedPhase', '==', 'submit')
  .get();

console.log('failed', failed.size);
for (const d of failed.docs) {
  const x = d.data();
  console.log(JSON.stringify({
    id: d.id,
    serial: x.serialNumber,
    customer: x.customerName,
    msg: x.pipelineFailureMessage,
    imgs: {
      stamping: Boolean(x.stampingImageUrl),
      scale: Boolean(x.scaleImageUrl),
      rear: Boolean(x.instrumentRearImageUrl),
      weight: Boolean(x.standardWeightImageUrl),
      seal: Boolean(x.verificationSealImageUrl),
    },
    pincode: x.pincode ?? null,
    customerId: x.customerId ?? null,
    rcId: x.rcId,
    subject: x.verificationSubject,
    performedBy: x.performedBy,
  }));
}

const rcIds = [...new Set(failed.docs.map((d) => d.data().rcId).filter(Boolean))];
for (const rcId of rcIds) {
  const snap = await db.collection('users').doc(rcId).get();
  const r = snap.exists ? snap.data() : {};
  console.log('RC', rcId, JSON.stringify({
    exists: snap.exists,
    name: r.displayName || r.name || r.companyName || r.rcName || null,
    pincode: r.pincode ?? null,
    postalCode: r.postalCode ?? null,
    district: r.district ?? null,
    state: r.state ?? null,
  }));
}

const certDoc = await db.collection('siteCalibrations').doc('0sTkswJcjC4RCioKf5Z6').get();
const c = certDoc.data() || {};
console.log(
  'CERT pin fields',
  Object.keys(c).filter((k) => /pin|postal|district|state|address/i.test(k)).map((k) => [k, c[k]]),
);

// Victory RC certified self OV — did they have pincode on RC then?
const victoryRc = 'dSuY7GyT0AVyFR7k3BDOsrqWxxL2';
const victoryCert = await db.collection('siteCalibrations')
  .where('rcId', '==', victoryRc)
  .where('status', '==', 'certified')
  .where('verificationSubject', '==', 'self')
  .limit(3)
  .get();
console.log('Victory self certified count sample', victoryCert.size);
for (const d of victoryCert.docs) {
  const x = d.data();
  console.log(JSON.stringify({
    id: d.id,
    serial: x.serialNumber,
    submittedAt: x.submittedAt,
    imgs: Boolean(x.stampingImageUrl),
    pincode: x.pincode ?? null,
  }));
}
