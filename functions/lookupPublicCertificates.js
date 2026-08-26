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

function optionalTrimmed(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function optionalFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

const STORAGE_BUCKET = 'yesgatc.firebasestorage.app';

function publicUrlFromStoragePath(path) {
  const trimmed = optionalTrimmed(path);
  if (!trimmed) return null;
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(trimmed)}?alt=media`;
}

function publicPhotoUrl(data, urlKey, pathKey) {
  const url = optionalTrimmed(data[urlKey]);
  if (url && isHttpUrl(url)) return url;
  return publicUrlFromStoragePath(data[pathKey]);
}

const PUBLIC_PHOTO_SLOTS = [
  { kind: 'stamping', label: 'Serial plate', urlKey: 'stampingImageUrl', pathKey: 'stampingImagePath' },
  { kind: 'scale', label: 'Front', urlKey: 'scaleImageUrl', pathKey: 'scaleImagePath' },
  { kind: 'instrumentRear', label: 'Rear', urlKey: 'instrumentRearImageUrl', pathKey: 'instrumentRearImagePath' },
  { kind: 'standardWeight', label: 'F2 test weight', urlKey: 'standardWeightImageUrl', pathKey: 'standardWeightImagePath' },
  { kind: 'verificationSeal', label: 'Seal', urlKey: 'verificationSealImageUrl', pathKey: 'verificationSealImagePath' },
];

function publicCertificatePhotos(data) {
  const photos = [];
  for (const slot of PUBLIC_PHOTO_SLOTS) {
    const url = publicPhotoUrl(data, slot.urlKey, slot.pathKey);
    if (!url) continue;
    photos.push({ kind: slot.kind, label: slot.label, url });
  }
  return photos;
}

function publicUnitOfMeasurement(value) {
  const unit = optionalTrimmed(value);
  return unit === 'kg' || unit === 'g' ? unit : null;
}

function toPublicCertificate(data) {
  const voided = Boolean(String(data.certificateVoidedAt || '').trim());
  const verificationType = data.verificationType === 'RV' || data.verificationType === 'OV'
    ? data.verificationType
    : null;
  const photos = publicCertificatePhotos(data);

  return {
    certificateNumber: optionalTrimmed(data.certificateNumber),
    serialNumber: optionalTrimmed(data.serialNumber),
    customerName: optionalTrimmed(data.customerName),
    certifiedAt: optionalTrimmed(data.certifiedAt),
    verificationType,
    voided,
    pdfUrl: voided ? null : resolvePublicCertificatePdfUrl(data),
    machinePhotoUrl: photos[0]?.url ?? null,
    photos,
    maximumCapacity: optionalFiniteNumber(data.maximumCapacity),
    verificationScaleInterval: optionalFiniteNumber(data.verificationScaleInterval),
    unitOfMeasurement: publicUnitOfMeasurement(data.unitOfMeasurement),
    accuracyClass: optionalTrimmed(data.accuracyClass),
  };
}

function httpStatusFromLookupError(err) {
  if (Number.isFinite(err?.httpErrorCode?.status)) return err.httpErrorCode.status;
  if (err?.code === 'invalid-argument') return 400;
  return 500;
}

function setPublicCertificateCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

async function lookupPublicCertificatesHttpHandler(req, res, db) {
  setPublicCertificateCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.' });
    return;
  }

  try {
    const query = req.body?.query ?? req.body?.data?.query;
    const result = await lookupPublicCertificatesHandler({ data: { query } }, db);
    res.status(200).json(result);
  } catch (err) {
    const status = httpStatusFromLookupError(err);
    res.status(status).json({
      error: status < 500 ? (err.message || 'Lookup failed.') : 'Lookup failed.',
    });
  }
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
  lookupPublicCertificatesHttpHandler,
  resolvePublicCertificatePdfUrl,
  buildLookupValues,
  isIssuedPublicCertificate,
  toPublicCertificate,
};
