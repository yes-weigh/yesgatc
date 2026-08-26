const crypto = require('crypto');
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
const YESONE_META_KEYS = new Set([
  'yesonePushStatus',
  'yesonePushedAt',
  'yesonePushError',
  'yesonePushFingerprint',
  'yesonePushEvent',
  'updatedAt',
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

function isVoidedCertificate(record) {
  return Boolean(String(record?.certificateVoidedAt || '').trim());
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

function shouldPushYesone(before, after) {
  if (!after) return false;
  if (!certificateReadyForYesone(after)) return false;
  if (before && onlyYesoneMetaChanged(before, after)) return false;
  return true;
}

function yesoneCertificateEvent(before, after) {
  if (isVoidedCertificate(after) && !isVoidedCertificate(before)) return 'certificate.voided';
  if (isCertificateSigned(after) && !isCertificateSigned(before)) {
    return 'certificate.certified_signed';
  }
  if (isCertificateCertifiedUnsigned(after) && !isCertificateCertifiedUnsigned(before)) {
    return 'certificate.certified_unsigned';
  }
  return 'certificate.updated';
}

function isRcAdminRecord(record) {
  return record?.role === 'rc_admin';
}

function isRcAccountActive(record) {
  return record?.active !== false;
}

function shouldPushYesoneRc(before, after) {
  if (!after || !isRcAdminRecord(after)) return false;
  if (before && onlyYesoneMetaChanged(before, after)) return false;
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

function buildYesoneCertificatePayload(recordId, record, customer, rc, event, occurredAt) {
  return envelope(event, recordId, occurredAt, {
    rc: rc ? buildYesoneRc(rc.id || record.rcId, rc) : null,
    certificate: buildYesoneCertificate(recordId, record, customer, rc),
  });
}

function buildYesoneRcPayload(uid, record, event, occurredAt) {
  return envelope(event, uid, occurredAt, {
    rc: buildYesoneRc(uid, record),
  });
}

function serializeYesonePayload(payload) {
  try {
    return JSON.stringify(payload);
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

async function postYesoneWebhook(url, payload) {
  const body = serializeYesonePayload(payload);
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
    await writeYesonePushResult(db, path, {
      yesonePushFingerprint: fingerprint,
      yesonePushEvent: payload.event,
      yesonePushedAt: payload.occurredAt,
      yesonePushStatus: 'failed',
      yesonePushError: message.slice(0, 500),
    });
    return { ok: false, event: payload.event, error: message };
  }

  const patch = {
    yesonePushFingerprint: fingerprint,
    yesonePushEvent: payload.event,
    yesonePushedAt: payload.occurredAt,
  };

  if (result.ok) {
    await writeYesonePushResult(db, path, {
      ...patch,
      yesonePushStatus: 'sent',
      yesonePushError: null,
    });
    return { ok: true, event: payload.event, status: result.status };
  }

  const error = `HTTP ${result.status}${result.text ? `: ${result.text}` : ''}`.slice(0, 500);
  if (result.status >= 500 && !options.continueOnError) {
    throw new Error(`Yesone webhook HTTP ${result.status}`);
  }

  await writeYesonePushResult(db, path, {
    ...patch,
    yesonePushStatus: 'failed',
    yesonePushError: error,
  });
  return { ok: false, event: payload.event, status: result.status, error };
}

async function processYesoneCertificatePush(db, recordId, record, before, options = {}) {
  if (!certificateReadyForYesone(record)) {
    return { skipped: true, reason: 'not_ready' };
  }
  const customer = options.customer === undefined
    ? await loadCustomer(db, record.customerId)
    : options.customer;
  const rc = options.rc === undefined ? await loadRc(db, record.rcId) : options.rc;
  const event = options.event || yesoneCertificateEvent(before, record);
  const occurredAt = new Date().toISOString();
  const payload = buildYesoneCertificatePayload(recordId, record, customer, rc, event, occurredAt);
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

const PUSH_ALL_BUDGET_MS = 500_000;
const PUSH_ALL_ERROR_CAP = 40;

async function listStatusDocs(db, collectionName, status) {
  const docs = [];
  let last = null;
  for (;;) {
    let query = db.collection(collectionName).where('status', '==', status).limit(100);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    if (page.empty) break;
    docs.push(...page.docs);
    last = page.docs[page.docs.length - 1];
    if (page.size < 100) break;
  }
  return docs;
}

function emptyPushLog(at) {
  return {
    at,
    ok: false,
    rcTotal: 0,
    rcSent: 0,
    rcFailed: 0,
    certTotal: 0,
    certSent: 0,
    certFailed: 0,
    certSkipped: 0,
    incomplete: false,
    errors: [],
  };
}

function appendPushError(log, entry) {
  if (log.errors.length >= PUSH_ALL_ERROR_CAP) return;
  log.errors.push(entry);
}

async function pushAllYesone(db) {
  const settings = await loadYesoneSettings(db);
  if (!settings.yesoneWebhookEnabled || !settings.yesoneWebhookUrl) {
    throw new HttpsError('failed-precondition', 'Save a yesone URL first.');
  }

  const started = Date.now();
  const at = new Date().toISOString();
  const log = emptyPushLog(at);
  const deliverOpts = {
    url: settings.yesoneWebhookUrl,
    force: true,
    continueOnError: true,
  };

  const rcSnap = await db.collection('users').where('role', '==', 'rc_admin').get();
  const rcById = new Map();
  log.rcTotal = rcSnap.size;
  for (const doc of rcSnap.docs) {
    if (Date.now() - started > PUSH_ALL_BUDGET_MS) {
      log.incomplete = true;
      break;
    }
    const data = doc.data();
    rcById.set(doc.id, { id: doc.id, ...data });
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
      continue;
    }
    if (result?.skipped) continue;
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
  }

  const seen = new Set();
  const certDocs = [
    ...(await listStatusDocs(db, 'siteCalibrations', 'certified')),
    ...(await listStatusDocs(db, 'siteCalibrations', 'approved')),
  ];
  const customerCache = new Map();

  for (const doc of certDocs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const record = doc.data();
    if (!certificateReadyForYesone(record)) {
      log.certSkipped += 1;
      continue;
    }
    log.certTotal += 1;
    if (log.incomplete || Date.now() - started > PUSH_ALL_BUDGET_MS) {
      log.incomplete = true;
      log.certSkipped += 1;
      continue;
    }

    const customerId = optionalTrimmed(record.customerId);
    if (customerId && !customerCache.has(customerId)) {
      customerCache.set(customerId, await loadCustomer(db, customerId));
    }
    const rcId = optionalTrimmed(record.rcId);
    const event = isCertificateSigned(record)
      ? 'certificate.certified_signed'
      : 'certificate.certified_unsigned';
    let result;
    try {
      result = await processYesoneCertificatePush(db, doc.id, record, null, {
        ...deliverOpts,
        event,
        customer: customerId ? customerCache.get(customerId) : null,
        rc: rcId ? rcById.get(rcId) || await loadRc(db, rcId) : null,
      });
    } catch (err) {
      log.certFailed += 1;
      appendPushError(log, {
        kind: 'certificate',
        id: doc.id,
        event,
        error: err instanceof Error ? err.message : 'Push failed.',
      });
      continue;
    }
    if (result?.skipped) {
      log.certSkipped += 1;
      continue;
    }
    if (result?.ok) log.certSent += 1;
    else {
      log.certFailed += 1;
      appendPushError(log, {
        kind: 'certificate',
        id: doc.id,
        event: result?.event || event,
        error: result?.error || 'Push failed.',
      });
    }
  }

  log.ok = log.rcFailed === 0 && log.certFailed === 0 && !log.incomplete;
  await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).set(
    {
      yesoneLastPushAt: at,
      yesoneLastPushLog: log,
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
  await processYesoneCertificatePush(db, event.params.recordId, after, before);
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

async function testYesoneWebhookHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  await assertSuperAdmin(db, request.auth.uid);
  try {
    return await pushAllYesone(db);
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

module.exports = {
  isAllowedYesoneWebhookUrl,
  normalizeYesoneWebhookSettings,
  certificateReadyForYesone,
  isCertificateSigned,
  isCertificateCertifiedUnsigned,
  onlyYesoneMetaChanged,
  shouldPushYesone,
  shouldPushYesoneRc,
  yesoneCertificateEvent,
  yesoneRcEvent,
  buildYesoneRc,
  buildYesoneCertificatePayload,
  payloadFingerprint,
  onSiteCalibrationYesoneWebhookHandler,
  onUserYesoneWebhookHandler,
  testYesoneWebhookHandler,
  testYesoneWebhookHttpHandler,
  processYesoneCertificatePush,
  processYesoneRcPush,
  pushAllYesone,
};
