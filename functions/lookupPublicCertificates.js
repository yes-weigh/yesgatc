const { HttpsError } = require('firebase-functions/v2/https');

const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 20;
const CORRUPTED_FIRESTORE_MARKER = 'System.Collections.Generic.Dictionary';

function isEmaapCertificatePdfUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.includes('thirpartycertificate')
    || lower.includes('thirdpartycertificate')
    || (lower.includes('gatcapi') && lower.includes('.pdf'))
  );
}

function resolvePublicCertificatePdfUrl(data) {
  const signed = String(data.signedCertificatePdfUrl || '').trim();
  if (signed) return signed;
  const emaap = String(data.emaapCertificatePdfUrl || '').trim();
  if (emaap && isEmaapCertificatePdfUrl(emaap)) return emaap;
  const stored = String(data.certificatePdfUrl || '').trim();
  return stored || null;
}

function normalizeLookupQuery(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function compactCertificateQuery(query) {
  return query.replace(/\\/g, '/').replace(/\s+/g, '').toUpperCase();
}

function buildLookupValues(query) {
  const serials = new Set([query]);
  serials.add(query.toUpperCase());
  serials.add(query.toLowerCase());

  const certificates = new Set([query]);
  const compact = compactCertificateQuery(query);
  if (compact) certificates.add(compact);

  return {
    serials: [...serials],
    certificates: [...certificates],
  };
}

function isIssuedPublicCertificate(data) {
  const certificateNumber = String(data.certificateNumber || '').trim();
  return Boolean(certificateNumber) && !certificateNumber.includes(CORRUPTED_FIRESTORE_MARKER);
}

function toPublicCertificate(data) {
  const voided = Boolean(String(data.certificateVoidedAt || '').trim());
  const verificationType = data.verificationType === 'RV' || data.verificationType === 'OV'
    ? data.verificationType
    : null;

  return {
    certificateNumber: String(data.certificateNumber || '').trim() || null,
    serialNumber: String(data.serialNumber || '').trim() || null,
    customerName: String(data.customerName || '').trim() || null,
    certifiedAt: String(data.certifiedAt || '').trim() || null,
    verificationType,
    voided,
    pdfUrl: voided ? null : resolvePublicCertificatePdfUrl(data),
  };
}

async function lookupPublicCertificatesHandler(request, db) {
  const query = normalizeLookupQuery(request.data?.query);
  if (query.length < MIN_QUERY_LENGTH) {
    throw new HttpsError('invalid-argument', 'Enter at least 3 characters.');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new HttpsError('invalid-argument', 'Search is too long.');
  }

  const { serials, certificates } = buildLookupValues(query);
  const col = db.collection('siteCalibrations');
  const reads = [
    ...serials.map(value => col.where('serialNumber', '==', value).limit(MAX_RESULTS).get()),
    ...certificates.map(value => col.where('certificateNumber', '==', value).limit(MAX_RESULTS).get()),
  ];

  const snaps = await Promise.all(reads);
  const byId = new Map();

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (byId.has(doc.id)) continue;
      const data = doc.data();
      if (!isIssuedPublicCertificate(data)) continue;
      byId.set(doc.id, toPublicCertificate(data));
    }
  }

  const hits = [...byId.values()].sort((a, b) => {
    const byDate = String(b.certifiedAt || '').localeCompare(String(a.certifiedAt || ''));
    if (byDate !== 0) return byDate;
    return String(a.certificateNumber || '').localeCompare(String(b.certificateNumber || ''));
  }).slice(0, MAX_RESULTS);

  return { query, certificates: hits };
}

module.exports = {
  lookupPublicCertificatesHandler,
  resolvePublicCertificatePdfUrl,
  buildLookupValues,
  isIssuedPublicCertificate,
  toPublicCertificate,
};
