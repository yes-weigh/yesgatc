const crypto = require('crypto');
const { FieldPath } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  isIssuedPublicCertificate,
  resolvePublicCertificatePdfUrl,
  toPublicCertificate,
} = require('./lookupPublicCertificates');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';
const POST_TIMEOUT_MS = 15_000;
const LEGACY_SIGNED_CERTIFICATE_SEQUENCE_MAX = 2304;
const LAST_CERTIFICATE_SEQUENCE_FLOOR = 3740;
const MASTER_RC_CODE = 'IWP';
const IWP_USED_FROM_DATE = '2026-08-28';
const IWP_UNUSED_QTY = 767;
const YESONE_META_KEYS = new Set([
  'yesonePushStatus',
  'yesonePushedAt',
  'yesonePushError',
  'yesonePushFingerprint',
  'yesonePushEvent',
  'updatedAt',
]);
const YESONE_RC_INBOUND_KEYS = new Set([
  'ovQuota',
  'ovQuotaUsed',
  'ovQuotaPeriod',
  'ovQuotaUpdatedAt',
  'ovQuotaSource',
  'yesoneAllottedSerials',
]);

function optionalTrimmed(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function optionalFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function isAllowedYesoneWebhookUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (local) return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  return parsed.protocol === 'https:';
}

function normalizeYesoneWebhookSettings(data) {
  const source = data && typeof data === 'object' ? data : {};
  const yesoneWebhookUrl = String(source.yesoneWebhookUrl || '').trim();
  const explicitEnabled = source.yesoneWebhookEnabled === true;
  const explicitDisabled = source.yesoneWebhookEnabled === false;
  const enabled = explicitDisabled
    ? false
    : explicitEnabled || isAllowedYesoneWebhookUrl(yesoneWebhookUrl);
  return {
    yesoneWebhookUrl,
    yesoneWebhookEnabled: enabled && isAllowedYesoneWebhookUrl(yesoneWebhookUrl),
  };
}

function jsonEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function onlyYesoneMetaChanged(before, after) {
  if (!before || !after) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (YESONE_META_KEYS.has(key)) continue;
    if (!jsonEqual(before[key], after[key])) return false;
  }
  return true;
}

function istDateKey(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function isOvRecord(record) {
  return String(record?.verificationType || 'OV').trim() !== 'RV';
}

function isVoidedCertificate(record) {
  return Boolean(String(record?.certificateVoidedAt || '').trim());
}

function isMasterRc(rc) {
  const code = String(rc?.rcCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
  if (code === MASTER_RC_CODE) return true;
  return String(rc?.companyName || '').toUpperCase().includes('INTERWEIGHING');
}

function ovShouldCount(record, rc) {
  if (!record || !isOvRecord(record)) return false;
  if (isVoidedCertificate(record)) return false;
  if (String(record.status || '').trim() === 'rejected') return false;
  if (isMasterRc(rc)) {
    const key = istDateKey(record.createdAt || '');
    if (!key || key < IWP_USED_FROM_DATE) return false;
  }
  return true;
}

function ovQuotaAction(before, after, rc) {
  const beforeOn = Boolean(before) && ovShouldCount(before, rc);
  const afterOn = Boolean(after) && ovShouldCount(after, rc);
  if (!beforeOn && afterOn) return { usedDelta: 1, unusedDelta: -1, action: 'consume' };
  if (beforeOn && !afterOn) return { usedDelta: -1, unusedDelta: 1, action: 'release' };
  return { usedDelta: 0, unusedDelta: 0, action: 'none' };
}

function countOvUsedFromRecords(records, rc) {
  const serials = new Set();
  let extra = 0;
  for (const record of records) {
    if (!ovShouldCount(record, rc)) continue;
    const serial = optionalTrimmed(record.serialNumber);
    if (serial) serials.add(serial);
    else extra += 1;
  }
  return serials.size + extra;
}

function buildRcOvUsedSnapshot(rc, usedCount) {
  const allotted = isMasterRc(rc) ? IWP_UNUSED_QTY : optionalFiniteNumber(rc?.ovQuota);
  const used = Math.max(0, Number.isFinite(usedCount) ? usedCount : 0);
  return {
    allotted,
    used,
    ovDone: used,
    ovQuotaUsed: used,
    balance: allotted != null ? allotted - used : null,
    usedDelta: 0,
    unusedDelta: 0,
    action: 'sync',
    rcCode: optionalTrimmed(rc?.rcCode),
    verificationType: 'OV',
  };
}

function buildOvQuotaPayload(record, rc, quotaAction, liveUsed) {
  const allotted = optionalFiniteNumber(rc?.ovQuota);
  const stored = optionalFiniteNumber(rc?.ovQuotaUsed);
  const used = liveUsed != null
    ? Math.max(0, liveUsed)
    : stored == null ? null : Math.max(0, stored + quotaAction.usedDelta);
  return {
    allotted,
    used,
    balance: allotted != null && used != null ? allotted - used : null,
    usedDelta: quotaAction.usedDelta,
    unusedDelta: quotaAction.unusedDelta,
    action: quotaAction.action,
    status: optionalTrimmed(record?.status) || 'draft',
    verificationType: optionalTrimmed(record?.verificationType) || 'OV',
    serialNumber: optionalTrimmed(record?.serialNumber),
    rcCode: optionalTrimmed(rc?.rcCode),
  };
}

function parseCertificateSequenceNumber(certificateNumber) {
  const parts = String(certificateNumber || '').trim().split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  const n = Number.parseInt(last, 10);
  return Number.isFinite(n) ? n : null;
}

function unsignedPdfUrl(record) {
  return optionalTrimmed(record?.certificatePdfUrl);
}

function hasSignedCertificatePdf(record) {
  return Boolean(
    optionalTrimmed(record?.signedCertificatePdfUrl)
    || optionalTrimmed(record?.signedCertificatePdfPath),
  );
}

function isLegacySignedCertificate(record) {
  const sequence = parseCertificateSequenceNumber(record?.certificateNumber);
  return sequence != null && sequence <= LEGACY_SIGNED_CERTIFICATE_SEQUENCE_MAX;
}

function isCertificateSigned(record) {
  if (!record || isVoidedCertificate(record)) return false;
  if (isLegacySignedCertificate(record)) return true;
  return hasSignedCertificatePdf(record);
}

function isCertificateCertifiedUnsigned(record) {
  if (!record || !isIssuedPublicCertificate(record) || isVoidedCertificate(record)) return false;
  return Boolean(unsignedPdfUrl(record) || resolvePublicCertificatePdfUrl(record));
}

function certificateReadyForYesone(record) {
  if (!record || !isIssuedPublicCertificate(record)) return false;
  if (isVoidedCertificate(record)) return true;
  return isCertificateCertifiedUnsigned(record) || isCertificateSigned(record);
}

function verificationReadyForYesone(record) {
  if (!record) return false;
  if (certificateReadyForYesone(record)) return true;
  return Boolean(
    optionalTrimmed(record.rcId)
    || optionalTrimmed(record.serialNumber)
    || optionalTrimmed(record.customerName)
    || optionalTrimmed(record.applicationNumber)
    || optionalTrimmed(record.customerId)
  );
}

function shouldPushYesone(before, after) {
  if (!after) return false;
  if (!verificationReadyForYesone(after)) return false;
  if (before && onlyYesoneMetaChanged(before, after)) return false;
  return true;
}

function verificationStatusEvent(after) {
  const status = String(after?.status || 'draft').trim() || 'draft';
  if (status === 'pending_rc') return 'verification.pending_rc';
  if (status === 'submitted') return 'verification.submitted';
  if (status === 'certified') return 'verification.certified';
  if (status === 'rejected') return 'verification.rejected';
  if (status === 'approved') return 'verification.approved';
  if (status === 'draft') return 'verification.draft';
  return `verification.status_${status}`;
}

function yesoneCertificateEvent(before, after) {
  if (isVoidedCertificate(after) && !isVoidedCertificate(before)) return 'certificate.voided';
  if (isCertificateSigned(after) && !isCertificateSigned(before)) {
    return 'certificate.certified_signed';
  }
  if (isCertificateCertifiedUnsigned(after) && !isCertificateCertifiedUnsigned(before)) {
    return 'certificate.certified_unsigned';
  }
  if (!before) return 'verification.created';
  const beforeStatus = String(before.status || 'draft').trim() || 'draft';
  const afterStatus = String(after.status || 'draft').trim() || 'draft';
  if (beforeStatus !== afterStatus) return verificationStatusEvent(after);
  return certificateReadyForYesone(after) ? 'certificate.updated' : 'verification.updated';
}

function isRcAdminRecord(record) {
  return record?.role === 'rc_admin';
}

function isRcAccountActive(record) {
  return record?.active !== false;
}

function onlyYesoneRcNoiseChanged(before, after) {
  if (!before || !after) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (YESONE_META_KEYS.has(key) || YESONE_RC_INBOUND_KEYS.has(key)) continue;
    if (!jsonEqual(before[key], after[key])) return false;
  }
  return true;
}

function shouldPushYesoneRc(before, after) {
  if (!after || !isRcAdminRecord(after)) return false;
  if (before && onlyYesoneRcNoiseChanged(before, after)) return false;
  return true;
}

function yesoneRcEvent(before, after) {
  if (!before || !isRcAdminRecord(before)) return 'rc.created';
  if (isRcAccountActive(before) && !isRcAccountActive(after)) return 'rc.deactivated';
  return 'rc.modified';
}

function buildYesoneRc(uid, record) {
  const location = record?.location;
  const lat = optionalFiniteNumber(location?.lat);
  const lng = optionalFiniteNumber(location?.lng);
  return {
    id: uid,
    aadhar: optionalTrimmed(record.aadhar),
    username: optionalTrimmed(record.username),
    companyName: optionalTrimmed(record.companyName),
    contactPerson: optionalTrimmed(record.contactPerson),
    phone: optionalTrimmed(record.phone),
    email: optionalTrimmed(record.email),
    address: optionalTrimmed(record.address),
    place: optionalTrimmed(record.place),
    pincode: optionalTrimmed(record.pincode),
    gstNumber: optionalTrimmed(record.gstNumber),
    panCard: optionalTrimmed(record.panCard),
    rcCode: optionalTrimmed(record.rcCode),
    zohoId: optionalTrimmed(record.zohoId),
    certificationMethod: optionalTrimmed(record.certificationMethod),
    laboratorySealIdentification: optionalTrimmed(record.laboratorySealIdentification),
    standardWeightsCertUrl: optionalTrimmed(record.standardWeightsCertUrl),
    standardWeightsCertNumber: optionalTrimmed(record.standardWeightsCertNumber),
    standardWeightsCertDate: optionalTrimmed(record.standardWeightsCertDate),
    standardWeightsCertExpiry: optionalTrimmed(record.standardWeightsCertExpiry),
    logoUrl: optionalTrimmed(record.logoUrl),
    sealUrl: optionalTrimmed(record.sealUrl),
    pdfSignerSignUrl: optionalTrimmed(record.pdfSignerSignUrl),
    pdfSignerSignScale: optionalFiniteNumber(record.pdfSignerSignScale),
    pdfSignerSignX: optionalFiniteNumber(record.pdfSignerSignX),
    pdfSignerSignY: optionalFiniteNumber(record.pdfSignerSignY),
    location: lat != null && lng != null ? { lat, lng } : null,
    feesStructure: record.feesStructure ?? null,
    active: isRcAccountActive(record),
    deactivatedAt: optionalTrimmed(record.deactivatedAt),
    createdAt: optionalTrimmed(record.createdAt),
    updatedAt: optionalTrimmed(record.updatedAt),
  };
}

function buildYesoneCertificate(recordId, record, customer, rc) {
  const pub = toPublicCertificate(record);
  const signed = isCertificateSigned(record);
  return {
    id: recordId,
    ...pub,
    signed,
    unsignedPdfUrl: unsignedPdfUrl(record),
    signedPdfUrl: optionalTrimmed(record.signedCertificatePdfUrl),
    emaapPdfUrl: optionalTrimmed(record.emaapCertificatePdfUrl),
    emaapSignedPdfUploadedAt: optionalTrimmed(record.emaapSignedPdfUploadedAt),
    applicationNumber: optionalTrimmed(record.applicationNumber),
    productId: optionalTrimmed(record.productId),
    productName: optionalTrimmed(record.productName),
    manufacturerBrandSeries: optionalTrimmed(record.manufacturerBrandSeries),
    modelApprovalNo: optionalTrimmed(record.modelApprovalNo),
    maximumPermissibleError: optionalFiniteNumber(record.maximumPermissibleError),
    ambientTemperature: optionalTrimmed(record.ambientTemperature),
    relativeHumidity: optionalTrimmed(record.relativeHumidity),
    sealIdentificationNumber: optionalTrimmed(record.sealIdentificationNumber),
    verificationLocation: optionalTrimmed(record.verificationLocation),
    verificationSubject: optionalTrimmed(record.verificationSubject),
    fileCertificateAsRc: record.fileCertificateAsRc === true,
    manufacturingYear: optionalFiniteNumber(record.manufacturingYear),
    performedBy: optionalTrimmed(record.performedBy),
    vctId: optionalTrimmed(record.vctId),
    vctName: optionalTrimmed(record.vctName),
    requestSource: optionalTrimmed(record.requestSource),
    deviceId: optionalTrimmed(record.deviceId),
    rcId: optionalTrimmed(record.rcId),
    customerId: optionalTrimmed(record.customerId),
    sourceCustomerId: optionalTrimmed(record.sourceCustomerId),
    sourceCustomerName: optionalTrimmed(record.sourceCustomerName),
    customerPhone: optionalTrimmed(customer?.phone),
    customerEmail: optionalTrimmed(customer?.email),
    customerAddress: optionalTrimmed(customer?.address),
    customerPincode: optionalTrimmed(customer?.pincode),
    customerDistrict: optionalTrimmed(customer?.district),
    customerState: optionalTrimmed(customer?.state),
    status: optionalTrimmed(record.status),
    submittedAt: optionalTrimmed(record.submittedAt),
    approvedAt: optionalTrimmed(record.approvedAt),
    pendingRcAt: optionalTrimmed(record.pendingRcAt),
    rcApprovedAt: optionalTrimmed(record.rcApprovedAt),
    rejectedAt: optionalTrimmed(record.rejectedAt),
    createdAt: optionalTrimmed(record.createdAt),
    verificationFeeBase: optionalFiniteNumber(record.verificationFeeBase),
    verificationFeeGst: optionalFiniteNumber(record.verificationFeeGst),
    verificationFeeTotal: optionalFiniteNumber(record.verificationFeeTotal),
    serviceFee: optionalFiniteNumber(record.serviceFee),
    additionalFee: optionalFiniteNumber(record.additionalFee),
    discountFee: optionalFiniteNumber(record.discountFee),
    gstBill: record.gstBill ?? null,
    rc: rc ? buildYesoneRc(rc.id || record.rcId, rc) : null,
  };
}

function envelope(event, id, occurredAt, extra) {
  return {
    event,
    id,
    occurredAt,
    source: 'yesgatc',
    rc: null,
    certificate: null,
    ...extra,
  };
}

function buildYesoneCertificatePayload(recordId, record, customer, rc, event, occurredAt, quota) {
  return envelope(event, recordId, occurredAt, {
    rc: rc ? buildYesoneRc(rc.id || record.rcId, rc) : null,
    certificate: buildYesoneCertificate(recordId, record, customer, rc),
    quota: quota || null,
  });
}

function buildYesoneRcPayload(uid, record, event, occurredAt) {
  return envelope(event, uid, occurredAt, {
    rc: buildYesoneRc(uid, record),
  });
}

function buildYesoneRcUsedPayload(uid, record, usedCount, event, occurredAt) {
  const quota = buildRcOvUsedSnapshot(record, usedCount);
  return envelope(event, uid, occurredAt, {
    rc: {
      ...buildYesoneRc(uid, record),
      ovUsed: quota.used,
      ovQuotaUsed: quota.used,
      ovQuota: quota.allotted,
      ovBalance: quota.balance,
    },
    quota,
  });
}

function toJsonable(value, seen = new WeakSet(), depth = 0) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return String(value);
  if (depth > 8) return null;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (Number.isFinite(value._seconds) && Number.isFinite(value._nanoseconds)) {
    return new Date(value._seconds * 1000).toISOString();
  }
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => toJsonable(item, seen, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === 'function') continue;
    out[key] = toJsonable(item, seen, depth + 1);
  }
  return out;
}

function serializeYesonePayload(payload) {
  try {
    return JSON.stringify(toJsonable(payload));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    throw new Error(`Yesone payload is not JSON-serializable: ${message}`);
  }
}

function payloadFingerprint(payload) {
  return crypto
    .createHash('sha256')
    .update(serializeYesonePayload({
      event: payload.event,
      rc: payload.rc ?? null,
      certificate: payload.certificate ?? null,
      quota: payload.quota ?? null,
    }))
    .digest('hex');
}

async function loadYesoneSettings(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  return normalizeYesoneWebhookSettings(snap.exists ? snap.data() : undefined);
}

async function loadCustomer(db, customerId) {
  const id = optionalTrimmed(customerId);
  if (!id) return null;
  try {
    const snap = await db.doc(`customers/${id}`).get();
    return snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
}

async function countLiveOvUsed(db, rcId, rc) {
  const id = optionalTrimmed(rcId);
  if (!id) return null;
  const snap = await db.collection('siteCalibrations').where('rcId', '==', id).get();
  return countOvUsedFromRecords(snap.docs.map(item => item.data()), rc);
}

async function liveOvUsedByRcId(db, rcById) {
  const buckets = new Map();
  for (const id of rcById.keys()) buckets.set(id, { serials: new Set(), extra: 0 });
  const docs = await listCollectionDocs(db, 'siteCalibrations');
  for (const doc of docs) {
    const record = doc.data();
    const rcId = optionalTrimmed(record.rcId);
    if (!rcId) continue;
    const rc = rcById.get(rcId);
    if (!rc || !ovShouldCount(record, rc)) continue;
    let bucket = buckets.get(rcId);
    if (!bucket) {
      bucket = { serials: new Set(), extra: 0 };
      buckets.set(rcId, bucket);
    }
    const serial = optionalTrimmed(record.serialNumber);
    if (serial) bucket.serials.add(serial);
    else bucket.extra += 1;
  }
  const counts = new Map();
  for (const [id, bucket] of buckets) {
    counts.set(id, bucket.serials.size + bucket.extra);
  }
  return counts;
}

async function loadRc(db, rcId) {
  const id = optionalTrimmed(rcId);
  if (!id) return null;
  try {
    const snap = await db.doc(`users/${id}`).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (data.role !== 'rc_admin') return null;
    return { id: snap.id, ...data };
  } catch {
    return null;
  }
}

async function writeYesonePushResult(db, path, patch) {
  await db.doc(path).set(
    {
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

async function postYesoneWebhookOnce(url, payload, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'yesgatc-yesone-webhook/1',
        'X-Yesgatc-Event': String(payload.event || ''),
        'X-Yesgatc-Id': String(payload.id || ''),
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text: text.slice(0, 400) };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Yesone webhook timed out.');
    }
    throw err instanceof Error ? err : new Error('Yesone webhook request failed.');
  } finally {
    clearTimeout(timer);
  }
}

async function postYesoneWebhook(url, payload) {
  const body = serializeYesonePayload(payload);
  let result = await postYesoneWebhookOnce(url, payload, body);
  if (!result.ok && result.status >= 500) {
    await new Promise(resolve => setTimeout(resolve, 400));
    result = await postYesoneWebhookOnce(url, payload, body);
  }
  return result;
}

async function deliverYesone(db, path, record, payload, options = {}) {
  const url = optionalTrimmed(options.url);
  const settings = url ? null : await loadYesoneSettings(db);
  const target = url || settings?.yesoneWebhookUrl;
  if (!target || (settings && !settings.yesoneWebhookEnabled)) {
    return { skipped: true, reason: 'disabled' };
  }

  const fingerprint = payloadFingerprint(payload);
  if (
    !options.force
    && record.yesonePushStatus === 'sent'
    && record.yesonePushFingerprint === fingerprint
  ) {
    return { skipped: true, reason: 'already_sent' };
  }

  let result;
  try {
    result = await postYesoneWebhook(target, payload);
  } catch (err) {
    if (!options.continueOnError) throw err;
    const message = err instanceof Error ? err.message : 'Yesone webhook request failed.';
    if (!options.skipMetaWrite) {
      await writeYesonePushResult(db, path, {
        yesonePushFingerprint: fingerprint,
        yesonePushEvent: payload.event,
        yesonePushedAt: payload.occurredAt,
        yesonePushStatus: 'failed',
        yesonePushError: message.slice(0, 500),
      });
    }
    return { ok: false, event: payload.event, error: message };
  }

  const patch = {
    yesonePushFingerprint: fingerprint,
    yesonePushEvent: payload.event,
    yesonePushedAt: payload.occurredAt,
  };

  if (result.ok) {
    if (!options.skipMetaWrite) {
      await writeYesonePushResult(db, path, {
        ...patch,
        yesonePushStatus: 'sent',
        yesonePushError: null,
      });
    }
    return { ok: true, event: payload.event, status: result.status };
  }

  const error = `HTTP ${result.status}${result.text ? `: ${result.text}` : ''}`.slice(0, 500);
  if (result.status >= 500 && !options.continueOnError) {
    throw new Error(`Yesone webhook HTTP ${result.status}`);
  }

  if (!options.skipMetaWrite) {
    await writeYesonePushResult(db, path, {
      ...patch,
      yesonePushStatus: 'failed',
      yesonePushError: error,
    });
  }
  return { ok: false, event: payload.event, status: result.status, error };
}

async function processYesoneCertificatePush(db, recordId, record, before, options = {}) {
  const issuedOnly = options.allowIssuedWithoutPdf === true;
  const ready = issuedOnly
    ? isIssuedPublicCertificate(record)
    : verificationReadyForYesone(record);
  if (!ready) {
    return { skipped: true, reason: 'not_ready' };
  }
  const customer = options.customer === undefined
    ? await loadCustomer(db, record.customerId)
    : options.customer;
  const rc = options.rc === undefined ? await loadRc(db, record.rcId) : options.rc;
  const event = options.event || yesoneCertificateEvent(before, record);
  const occurredAt = new Date().toISOString();
  const quotaAction = options.liveQuota
    ? ovQuotaAction(before, record, rc)
    : { usedDelta: 0, unusedDelta: 0, action: 'none' };
  let liveUsed = options.liveUsed;
  if (liveUsed == null && options.liveQuota && rc) {
    liveUsed = await countLiveOvUsed(db, rc.id || record.rcId, rc);
  }
  const quota = buildOvQuotaPayload(record, rc, quotaAction, liveUsed);
  const payload = buildYesoneCertificatePayload(recordId, record, customer, rc, event, occurredAt, quota);
  return deliverYesone(db, `siteCalibrations/${recordId}`, record, payload, options);
}

async function processYesoneRcPush(db, uid, record, before, options = {}) {
  if (!isRcAdminRecord(record)) {
    return { skipped: true, reason: 'not_rc' };
  }
  const event = options.event || yesoneRcEvent(before, record);
  const occurredAt = new Date().toISOString();
  const payload = buildYesoneRcPayload(uid, record, event, occurredAt);
  return deliverYesone(db, `users/${uid}`, record, payload, options);
}

const PUSH_ALL_BUDGET_MS = 520_000;
const PUSH_ALL_ERROR_CAP = 40;
const PUSH_CONCURRENCY = 16;
const PROGRESS_MIN_INTERVAL_MS = 400;

async function listCollectionDocs(db, collectionName) {
  const docs = [];
  let last = null;
  for (;;) {
    let query = db.collection(collectionName).orderBy(FieldPath.documentId()).limit(500);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) break;
    docs.push(...page.docs);
    last = page.docs[page.docs.length - 1];
    if (page.size < 500) break;
  }
  return docs;
}

function issuedRecordScore(record) {
  let score = 0;
  if (hasSignedCertificatePdf(record)) score += 4;
  if (unsignedPdfUrl(record) || resolvePublicCertificatePdfUrl(record)) score += 2;
  if (String(record.status || '') === 'certified') score += 1;
  return score;
}

function uniqueIssuedCertificates(docs) {
  const byNumber = new Map();
  for (const doc of docs) {
    const record = doc.data();
    if (!isIssuedPublicCertificate(record)) continue;
    const number = String(record.certificateNumber || '').trim();
    if (!number) continue;
    const prev = byNumber.get(number);
    if (!prev || issuedRecordScore(record) > issuedRecordScore(prev.record)) {
      byNumber.set(number, { id: doc.id, record });
    }
  }
  return [...byNumber.values()];
}

function emptyPushLog(at) {
  return {
    at,
    ok: false,
    phase: 'counting',
    rcTotal: 0,
    rcSent: 0,
    rcFailed: 0,
    certTotal: 0,
    certSent: 0,
    certFailed: 0,
    certSkipped: 0,
    certLatestSequence: LAST_CERTIFICATE_SEQUENCE_FLOOR,
    incomplete: false,
    errors: [],
  };
}

function publicPushLog(log, includeErrors) {
  return {
    at: log.at,
    ok: Boolean(log.ok),
    phase: log.phase || '',
    rcTotal: log.rcTotal,
    rcSent: log.rcSent,
    rcFailed: log.rcFailed,
    certTotal: log.certTotal,
    certSent: log.certSent,
    certFailed: log.certFailed,
    certSkipped: log.certSkipped,
    certLatestSequence: log.certLatestSequence || LAST_CERTIFICATE_SEQUENCE_FLOOR,
    incomplete: Boolean(log.incomplete),
    errors: includeErrors ? log.errors : [],
  };
}

function appendPushError(log, entry) {
  if (log.errors.length >= PUSH_ALL_ERROR_CAP) return;
  log.errors.push(entry);
}

async function runPool(items, concurrency, worker) {
  if (items.length === 0) return;
  let next = 0;
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }));
}

function memoLoad(map, id, loader) {
  if (!id) return Promise.resolve(null);
  let pending = map.get(id);
  if (!pending) {
    pending = loader();
    map.set(id, pending);
  }
  return pending;
}

function createProgressSink(db, onProgress) {
  let lastWrite = 0;
  let timer = null;
  let latest = null;

  async function writeProgress(log, running) {
    await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).set(
      {
        yesonePushProgress: {
          ...publicPushLog(log, false),
          running,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  function emit(log, force = false) {
    latest = log;
    onProgress?.(log);
    const now = Date.now();
    if (!force && now - lastWrite < PROGRESS_MIN_INTERVAL_MS) {
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (latest) {
            lastWrite = Date.now();
            void writeProgress(latest, true).catch(err => {
              console.error('yesone progress write', err);
            });
          }
        }, PROGRESS_MIN_INTERVAL_MS - (now - lastWrite));
      }
      return;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastWrite = now;
    void writeProgress(log, true).catch(err => {
      console.error('yesone progress write', err);
    });
  }

  async function finish(log) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    log.phase = 'done';
    onProgress?.(log);
    await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).set(
      {
        yesoneLastPushAt: log.at,
        yesoneLastPushLog: publicPushLog(log, true),
        yesonePushProgress: {
          ...publicPushLog(log, false),
          running: false,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  return { emit, finish };
}

async function pushAllYesone(db, options = {}) {
  const settings = await loadYesoneSettings(db);
  if (!settings.yesoneWebhookEnabled || !settings.yesoneWebhookUrl) {
    throw new HttpsError('failed-precondition', 'Save a yesone URL first.');
  }

  const started = Date.now();
  const at = new Date().toISOString();
  const log = emptyPushLog(at);
  const sink = createProgressSink(db, options.onProgress);
  const deliverOpts = {
    url: settings.yesoneWebhookUrl,
    force: true,
    continueOnError: true,
    skipMetaWrite: true,
    allowIssuedWithoutPdf: true,
  };

  try {
    sink.emit(log, true);

    const rcSnap = await db.collection('users').where('role', '==', 'rc_admin').get();
    const rcById = new Map();
    for (const doc of rcSnap.docs) {
      rcById.set(doc.id, { id: doc.id, ...doc.data() });
    }
    log.rcTotal = rcSnap.size;
    log.phase = 'rc';
    sink.emit(log, true);

    await runPool(rcSnap.docs, Math.min(PUSH_CONCURRENCY, 8), async doc => {
      if (Date.now() - started > PUSH_ALL_BUDGET_MS) {
        log.incomplete = true;
        return;
      }
      const data = doc.data();
      let result;
      try {
        result = await processYesoneRcPush(db, doc.id, data, null, {
          ...deliverOpts,
          event: 'rc.sync',
        });
      } catch (err) {
        log.rcFailed += 1;
        appendPushError(log, {
          kind: 'rc',
          id: doc.id,
          event: 'rc.sync',
          error: err instanceof Error ? err.message : 'Push failed.',
        });
        sink.emit(log);
        return;
      }
      if (result?.skipped) return;
      if (result?.ok) log.rcSent += 1;
      else {
        log.rcFailed += 1;
        appendPushError(log, {
          kind: 'rc',
          id: doc.id,
          event: result?.event || 'rc.sync',
          error: result?.error || 'Push failed.',
        });
      }
      sink.emit(log);
    });

    log.phase = 'counting';
    sink.emit(log, true);

    const ready = uniqueIssuedCertificates(await listCollectionDocs(db, 'siteCalibrations'));
    log.certTotal = ready.length;
    let latestSequence = LAST_CERTIFICATE_SEQUENCE_FLOOR;
    for (const item of ready) {
      const sequence = parseCertificateSequenceNumber(item.record.certificateNumber);
      if (sequence != null && sequence > latestSequence) latestSequence = sequence;
    }
    log.certLatestSequence = latestSequence;
    log.phase = 'certificate';
    sink.emit(log, true);

    const customerCache = new Map();
    await runPool(ready, PUSH_CONCURRENCY, async item => {
      if (Date.now() - started > PUSH_ALL_BUDGET_MS) {
        log.incomplete = true;
        return;
      }
      const { id, record } = item;
      const customerId = optionalTrimmed(record.customerId);
      const rcId = optionalTrimmed(record.rcId);
      const event = isCertificateSigned(record)
        ? 'certificate.certified_signed'
        : 'certificate.certified_unsigned';
      let result;
      try {
        const customer = await memoLoad(customerCache, customerId, () => loadCustomer(db, customerId));
        const rc = rcId
          ? rcById.get(rcId) || await memoLoad(customerCache, `rc:${rcId}`, () => loadRc(db, rcId))
          : null;
        result = await processYesoneCertificatePush(db, id, record, null, {
          ...deliverOpts,
          event,
          customer,
          rc,
        });
      } catch (err) {
        log.certFailed += 1;
        appendPushError(log, {
          kind: 'certificate',
          id,
          event,
          error: err instanceof Error ? err.message : 'Push failed.',
        });
        sink.emit(log);
        return;
      }
      if (result?.skipped) {
        log.certSkipped += 1;
        sink.emit(log);
        return;
      }
      if (result?.ok) log.certSent += 1;
      else {
        log.certFailed += 1;
        appendPushError(log, {
          kind: 'certificate',
          id,
          event: result?.event || event,
          error: result?.error || 'Push failed.',
        });
      }
      sink.emit(log);
    });

    log.ok = log.rcFailed === 0 && log.certFailed === 0 && !log.incomplete
      && (log.rcSent + log.rcFailed) >= log.rcTotal
      && (log.certSent + log.certFailed) >= log.certTotal;
    await sink.finish(log);
    return log;
  } catch (err) {
    log.ok = false;
    log.incomplete = true;
    appendPushError(log, {
      kind: 'run',
      id: 'pushAll',
      error: err instanceof Error ? err.message : 'Yesone push failed.',
    });
    await sink.finish(log).catch(() => {});
    throw err;
  }
}

async function pushYesoneOvUsed(db) {
  const settings = await loadYesoneSettings(db);
  if (!settings.yesoneWebhookEnabled || !settings.yesoneWebhookUrl) {
    throw new HttpsError('failed-precondition', 'Save a yesone URL first.');
  }

  const at = new Date().toISOString();
  const log = {
    at,
    ok: false,
    rcTotal: 0,
    rcSent: 0,
    rcFailed: 0,
    errors: [],
  };

  const rcSnap = await db.collection('users').where('role', '==', 'rc_admin').get();
  const rcById = new Map();
  for (const doc of rcSnap.docs) {
    rcById.set(doc.id, { id: doc.id, ...doc.data() });
  }
  log.rcTotal = rcSnap.size;
  const usedByRc = await liveOvUsedByRcId(db, rcById);
  const deliverOpts = {
    url: settings.yesoneWebhookUrl,
    force: true,
    continueOnError: true,
    skipMetaWrite: true,
  };

  await runPool(rcSnap.docs, Math.min(PUSH_CONCURRENCY, 8), async doc => {
    const rc = rcById.get(doc.id);
    const used = usedByRc.get(doc.id) || 0;
    const payload = buildYesoneRcUsedPayload(doc.id, rc, used, 'rc.ov_used', new Date().toISOString());
    let result;
    try {
      result = await deliverYesone(db, `users/${doc.id}`, rc, payload, deliverOpts);
    } catch (err) {
      log.rcFailed += 1;
      appendPushError(log, {
        kind: 'rc',
        id: doc.id,
        event: 'rc.ov_used',
        error: err instanceof Error ? err.message : 'Push failed.',
      });
      return;
    }
    if (result?.skipped) {
      log.rcFailed += 1;
      appendPushError(log, {
        kind: 'rc',
        id: doc.id,
        event: 'rc.ov_used',
        error: result.reason || 'skipped',
      });
      return;
    }
    if (result?.ok) log.rcSent += 1;
    else {
      log.rcFailed += 1;
      appendPushError(log, {
        kind: 'rc',
        id: doc.id,
        event: result?.event || 'rc.ov_used',
        error: result?.error || 'Push failed.',
      });
    }
  });

  log.ok = log.rcFailed === 0 && log.rcSent === log.rcTotal;
  await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).set(
    {
      yesoneLastOvUsedSyncAt: log.at,
      yesoneLastOvUsedSyncLog: {
        at: log.at,
        ok: log.ok,
        rcTotal: log.rcTotal,
        rcSent: log.rcSent,
        rcFailed: log.rcFailed,
        errors: log.errors.slice(0, PUSH_ALL_ERROR_CAP),
      },
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  return log;
}

async function onSiteCalibrationYesoneWebhookHandler(event, db) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!shouldPushYesone(before, after)) return;
  await processYesoneCertificatePush(db, event.params.recordId, after, before, { liveQuota: true });
}

async function onUserYesoneWebhookHandler(event, db) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!shouldPushYesoneRc(before, after)) return;
  await processYesoneRcPush(db, event.params.userId, after, before);
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function testYesoneWebhookHandler(request, db, options = {}) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  await assertSuperAdmin(db, request.auth.uid);
  try {
    return await pushAllYesone(db, options);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const message = err instanceof Error ? err.message : 'Yesone push failed.';
    console.error('testYesoneWebhook failed', err);
    throw new HttpsError('failed-precondition', message);
  }
}

async function testYesoneWebhookHttpHandler(req, res, db, auth) {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.' });
    return;
  }

  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Sign in required.' });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    const log = await testYesoneWebhookHandler({ auth: { uid: decoded.uid } }, db);
    res.status(200).json(log);
  } catch (err) {
    const authCode = String(err?.code || '');
    if (authCode.startsWith('auth/')) {
      res.status(401).json({ error: 'Sign in required.' });
      return;
    }
    if (err instanceof HttpsError) {
      const status = Number(err.httpErrorCode?.status) || 400;
      res.status(status).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Yesone push failed.';
    console.error('testYesoneWebhook failed', err);
    res.status(400).json({ error: message });
  }
}

async function syncYesoneOvUsedHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  await assertSuperAdmin(db, request.auth.uid);
  try {
    return await pushYesoneOvUsed(db);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    const message = err instanceof Error ? err.message : 'Yesone used sync failed.';
    console.error('syncYesoneOvUsed failed', err);
    throw new HttpsError('failed-precondition', message);
  }
}

async function syncYesoneOvUsedHttpHandler(req, res, db, auth) {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only.' });
    return;
  }

  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Sign in required.' });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    const log = await syncYesoneOvUsedHandler({ auth: { uid: decoded.uid } }, db);
    res.status(200).json(log);
  } catch (err) {
    const authCode = String(err?.code || '');
    if (authCode.startsWith('auth/')) {
      res.status(401).json({ error: 'Sign in required.' });
      return;
    }
    if (err instanceof HttpsError) {
      const status = Number(err.httpErrorCode?.status) || 400;
      res.status(status).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Yesone used sync failed.';
    console.error('syncYesoneOvUsed failed', err);
    res.status(400).json({ error: message });
  }
}

module.exports = {
  isAllowedYesoneWebhookUrl,
  normalizeYesoneWebhookSettings,
  certificateReadyForYesone,
  verificationReadyForYesone,
  isCertificateSigned,
  isCertificateCertifiedUnsigned,
  onlyYesoneMetaChanged,
  shouldPushYesone,
  shouldPushYesoneRc,
  ovQuotaAction,
  countOvUsedFromRecords,
  buildOvQuotaPayload,
  buildRcOvUsedSnapshot,
  yesoneCertificateEvent,
  yesoneRcEvent,
  buildYesoneRc,
  buildYesoneCertificatePayload,
  buildYesoneRcUsedPayload,
  uniqueIssuedCertificates,
  payloadFingerprint,
  onSiteCalibrationYesoneWebhookHandler,
  onUserYesoneWebhookHandler,
  testYesoneWebhookHandler,
  testYesoneWebhookHttpHandler,
  syncYesoneOvUsedHandler,
  syncYesoneOvUsedHttpHandler,
  processYesoneCertificatePush,
  processYesoneRcPush,
  pushAllYesone,
  pushYesoneOvUsed,
};
