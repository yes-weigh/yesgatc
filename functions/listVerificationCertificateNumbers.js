const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');

const PAGE = 500;

function normalizeCertificateMatchKey(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, '').toUpperCase();
}

/**
 * Returns normalized certificate numbers from siteCalibrations.
 * Admin field mask — APAC clients never download fat docs for DOCA matching.
 */
async function listVerificationCertificateNumbersHandler(request, getCallerRole) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const role = await getCallerRole(request.auth.uid);
  if (role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }

  const db = getFirestore();
  const numbers = [];
  let last = null;
  for (;;) {
    let q = db.collection('siteCalibrations').select('certificateNumber').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const docSnap of snap.docs) {
      const key = normalizeCertificateMatchKey(docSnap.get('certificateNumber'));
      if (key) numbers.push(key);
    }
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
  }

  return { numbers: [...new Set(numbers)] };
}

module.exports = { listVerificationCertificateNumbersHandler };
