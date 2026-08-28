const crypto = require('crypto');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';
const SERIAL_COLLECTION = 'serialAllotments';
const INBOUND_EVENTS_COLLECTION = 'yesoneInboundEvents';
const INBOUND_LOG_LIMIT = 200;
const MAX_EVENTS = 40;
const ISSUED_VERIFICATION_STATUSES = new Set(['certified', 'approved', 'submitted']);

const EVENT_ALIASES = {
  'serial.allotted': 'serial.allotted',
  'serial.allotment': 'serial.allotted',
  'serial.allocated': 'serial.allotted',
  'serial.created': 'serial.allotted',
  'serial.new': 'serial.allotted',
  new_serial: 'serial.allotted',
  serial_allotment: 'serial.allotted',
  'serial.updated': 'serial.updated',
  'serial.changed': 'serial.updated',
  'serial.renamed': 'serial.updated',
  serial_update: 'serial.updated',
  serial_change: 'serial.updated',
  'serial.cancelled': 'serial.cancelled',
  'serial.canceled': 'serial.cancelled',
  'serial.voided': 'serial.cancelled',
  'rc.ov_quota': 'rc.ov_quota',
  'ov.quota': 'rc.ov_quota',
  'rc.quota': 'rc.ov_quota',
  ov_quota: 'rc.ov_quota',
  quota: 'rc.ov_quota',
};

function optionalTrimmed(value) {
  if (value == null) return null;
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  return text || null;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function optionalFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRcCode(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
}

function secretsEqual(provided, expected) {
  const left = Buffer.from(String(provided ?? ''), 'utf8');
  const right = Buffer.from(String(expected ?? ''), 'utf8');
  if (!right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function serialDocId(serial) {
  const trimmed = optionalTrimmed(serial);
  if (!trimmed) return null;
  return trimmed.toUpperCase().replace(/[/\\]/g, '_').slice(0, 700);
}

function readJsonBody(req) {
  const body = req.body;
  if (body == null || body === '') return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      return {};
    }
  }
  return typeof body === 'object' ? body : {};
}

function readInboundToken(req, body) {
  const fromQuery = optionalTrimmed(req.query?.token || req.query?.key);
  if (fromQuery) return fromQuery;
  const header = optionalTrimmed(
    req.get?.('x-yesone-token')
    || req.headers?.['x-yesone-token']
    || req.get?.('x-yesone-secret')
    || req.headers?.['x-yesone-secret'],
  );
  if (header) return header;
  return optionalTrimmed(body?.token || body?.secret);
}

function normalizeEventName(raw) {
  const key = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  return EVENT_ALIASES[key] || optionalTrimmed(raw);
}

function inferEventName(item) {
  const named = normalizeEventName(
    item.event || item.type || item.kind || item.action || item.name,
  );
  if (named) return named;
  if (readPreviousSerial(item) && readSerialNumber(item)) return 'serial.updated';
  if (readQuotaValue(item) != null) return 'rc.ov_quota';
  if (readSerialNumber(item) || Array.isArray(item.serials)) return 'serial.allotted';
  return null;
}

function readSerialNumber(item) {
  const serial = asRecord(item.serial);
  return optionalTrimmed(
    item.serialNumber
    || item.newSerialNumber
    || item.newSerial
    || (typeof item.serial === 'string' ? item.serial : null)
    || serial.number
    || serial.serialNumber
    || item.to
    || item.toSerial,
  );
}

function readPreviousSerial(item) {
  const serial = asRecord(item.serial);
  return optionalTrimmed(
    item.previousSerialNumber
    || item.oldSerialNumber
    || item.oldSerial
    || item.from
    || item.fromSerial
    || item.previous
    || serial.previous
    || serial.old,
  );
}

function firstFiniteAmount(candidates) {
  for (const candidate of candidates) {
    const n = optionalFiniteNumber(candidate);
    if (n != null && n >= 0) return n;
  }
  return null;
}

function readQuotaValue(item) {
  const quota = asRecord(item.quota);
  return firstFiniteAmount([
    item.ovQuota,
    typeof item.quota === 'number' ? item.quota : null,
    item.allotted,
    item.limit,
    quota.ov,
    quota.allotted,
    quota.limit,
  ]);
}

function readQuotaUsed(item) {
  const quota = asRecord(item.quota);
  return firstFiniteAmount([item.ovQuotaUsed, item.used, item.usedCount, quota.used]);
}

function expandInboundItems(body) {
  const root = asRecord(body);
  const data = asRecord(root.data);
  const mergedRoot = { ...root, ...data };
  delete mergedRoot.data;
  delete mergedRoot.token;
  delete mergedRoot.secret;

  if (Array.isArray(body)) return body.slice(0, MAX_EVENTS).map(item => asRecord(item));
  if (Array.isArray(root.events)) return root.events.slice(0, MAX_EVENTS).map(item => asRecord(item));
  if (Array.isArray(root.items)) {
    return root.items.slice(0, MAX_EVENTS).map(item => ({ ...mergedRoot, ...asRecord(item), items: undefined }));
  }
  if (Array.isArray(root.serials)) {
    return root.serials.slice(0, MAX_EVENTS).map(serial => (
      typeof serial === 'string' || typeof serial === 'number'
        ? { ...mergedRoot, serialNumber: String(serial), serials: undefined }
        : { ...mergedRoot, ...asRecord(serial), serials: undefined }
    ));
  }
  return [mergedRoot];
}

function compactPayload(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 40).map(item => compactPayload(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === 'function') continue;
    if (key === 'token' || key === 'secret') continue;
    out[key] = compactPayload(item, depth + 1);
  }
  return out;
}

function setInboundCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Yesone-Token, X-Yesone-Secret, Authorization');
  res.set('Access-Control-Max-Age', '3600');
}

async function loadInboundToken(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  if (!snap.exists) return '';
  return optionalTrimmed(snap.data()?.yesoneInboundToken) || '';
}

async function resolveRc(db, item) {
  const rc = asRecord(item.rc);
  const rcId = optionalTrimmed(item.rcId || item.rcUid || rc.id || rc.uid);
  if (rcId) {
    const snap = await db.doc(`users/${rcId}`).get();
    if (snap.exists && snap.data()?.role === 'rc_admin') {
      return { id: snap.id, ...snap.data() };
    }
  }

  const rcCode = normalizeRcCode(item.rcCode || rc.rcCode || rc.code);
  if (rcCode) {
    const snap = await db.collection('users').where('rcCode', '==', rcCode).limit(4).get();
    const hit = snap.docs.find(doc => doc.data()?.role === 'rc_admin');
    if (hit) return { id: hit.id, ...hit.data() };
  }

  const aadhar = optionalTrimmed(item.aadhar || item.rcAadhar || rc.aadhar);
  if (aadhar) {
    const snap = await db.collection('users').where('aadhar', '==', aadhar).limit(1).get();
    if (!snap.empty && snap.docs[0].data()?.role === 'rc_admin') {
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }
  }

  return null;
}

function allotmentFields(item, rc, serialNumber, extra = {}) {
  const product = asRecord(item.product);
  return {
    serialNumber,
    rcId: rc?.id || optionalTrimmed(item.rcId) || null,
    rcCode: normalizeRcCode(item.rcCode || rc?.rcCode) || null,
    rcCompanyName: optionalTrimmed(rc?.companyName || item.rcCompanyName),
    productId: optionalTrimmed(item.productId || product.id),
    productName: optionalTrimmed(item.productName || product.name || product.productName),
    modelNo: optionalTrimmed(item.modelNo || product.modelNo),
    source: 'yesone',
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function verificationLocked(record) {
  if (!record) return false;
  if (optionalTrimmed(record.certificateNumber)) return true;
  return ISSUED_VERIFICATION_STATUSES.has(String(record.status || '').trim());
}

function serialList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

async function patchRcAllottedSerials(db, rcId, mutate) {
  const id = optionalTrimmed(rcId);
  if (!id) return;
  const ref = db.doc(`users/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const next = mutate(serialList(snap.data()?.yesoneAllottedSerials));
  await ref.set(
    {
      yesoneAllottedSerials: next,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

async function applySerialAllotted(db, item) {
  const serialNumber = readSerialNumber(item);
  if (!serialNumber) return { ok: false, event: 'serial.allotted', error: 'serial_required' };
  const rc = await resolveRc(db, item);
  const id = serialDocId(serialNumber);
  const now = new Date().toISOString();
  await db.doc(`${SERIAL_COLLECTION}/${id}`).set(
    allotmentFields(item, rc, serialNumber, {
      status: 'allotted',
      allottedAt: optionalTrimmed(item.allottedAt) || now,
    }),
    { merge: true },
  );
  await patchRcAllottedSerials(db, rc?.id, list => (
    list.includes(serialNumber) ? list : [...list, serialNumber]
  ));
  return {
    ok: true,
    event: 'serial.allotted',
    id: serialNumber,
    rcId: rc?.id || null,
    warning: rc ? null : 'rc_not_found',
  };
}

async function applySerialCancelled(db, item) {
  const serialNumber = readSerialNumber(item);
  if (!serialNumber) return { ok: false, event: 'serial.cancelled', error: 'serial_required' };
  const id = serialDocId(serialNumber);
  const snap = await db.doc(`${SERIAL_COLLECTION}/${id}`).get();
  const previous = snap.exists ? snap.data() : {};
  const rc = await resolveRc(db, item);
  await db.doc(`${SERIAL_COLLECTION}/${id}`).set(
    {
      serialNumber,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'yesone',
    },
    { merge: true },
  );
  await patchRcAllottedSerials(db, rc?.id || previous.rcId, list => (
    list.filter(serial => serial !== serialNumber)
  ));
  return { ok: true, event: 'serial.cancelled', id: serialNumber };
}

async function applySerialUpdated(db, item) {
  const nextSerial = readSerialNumber(item);
  const previousSerial = readPreviousSerial(item);
  if (!nextSerial || !previousSerial) {
    return { ok: false, event: 'serial.updated', error: 'serial_from_to_required' };
  }
  if (nextSerial === previousSerial) {
    return { ok: true, event: 'serial.updated', id: nextSerial, skipped: 'unchanged' };
  }

  const rc = await resolveRc(db, item);
  const now = new Date().toISOString();
  const oldId = serialDocId(previousSerial);
  const newId = serialDocId(nextSerial);
  const oldSnap = await db.doc(`${SERIAL_COLLECTION}/${oldId}`).get();
  const previous = oldSnap.exists ? oldSnap.data() : {};

  await db.doc(`${SERIAL_COLLECTION}/${oldId}`).set(
    {
      ...previous,
      serialNumber: previousSerial,
      status: 'replaced',
      replacedBy: nextSerial,
      updatedAt: now,
      source: 'yesone',
    },
    { merge: true },
  );
  await db.doc(`${SERIAL_COLLECTION}/${newId}`).set(
    allotmentFields(
      { ...previous, ...item },
      rc || (previous.rcId ? { id: previous.rcId, rcCode: previous.rcCode, companyName: previous.rcCompanyName } : null),
      nextSerial,
      {
        status: 'allotted',
        previousSerialNumber: previousSerial,
        allottedAt: previous.allottedAt || now,
      },
    ),
    { merge: true },
  );

  const calibSnap = await db.collection('siteCalibrations')
    .where('serialNumber', '==', previousSerial)
    .limit(40)
    .get();
  let updated = 0;
  let skippedIssued = 0;
  for (const doc of calibSnap.docs) {
    const record = doc.data() || {};
    if (verificationLocked(record)) {
      skippedIssued += 1;
      continue;
    }
    await doc.ref.update({
      serialNumber: nextSerial,
      previousSerialNumber: previousSerial,
      updatedAt: now,
    });
    updated += 1;
  }

  const customerId = optionalTrimmed(item.customerId);
  if (customerId) {
    const customerSnap = await db.doc(`customers/${customerId}`).get();
    if (customerSnap.exists) {
      const customer = customerSnap.data() || {};
      const devices = Array.isArray(customer.devices) ? customer.devices : [];
      const nextDevices = devices.map(device => (
        optionalTrimmed(device?.serialNumber) === previousSerial
          ? { ...device, serialNumber: nextSerial }
          : device
      ));
      await customerSnap.ref.update({ devices: nextDevices, updatedAt: now });
    }
  }

  await patchRcAllottedSerials(db, rc?.id || previous.rcId, list => {
    const next = list.filter(serial => serial !== previousSerial);
    return next.includes(nextSerial) ? next : [...next, nextSerial];
  });

  return {
    ok: true,
    event: 'serial.updated',
    id: nextSerial,
    previousSerialNumber: previousSerial,
    verificationsUpdated: updated,
    issuedSkipped: skippedIssued,
    rcId: rc?.id || previous.rcId || null,
  };
}

async function applyOvQuota(db, item) {
  const quota = readQuotaValue(item);
  if (quota == null) return { ok: false, event: 'rc.ov_quota', error: 'quota_required' };
  const rc = await resolveRc(db, item);
  if (!rc) return { ok: false, event: 'rc.ov_quota', error: 'rc_not_found' };
  const used = readQuotaUsed(item);
  const period = optionalTrimmed(item.ovQuotaPeriod || item.period || item.month || item.fy)
    || optionalTrimmed(asRecord(item.quota).period);
  const now = new Date().toISOString();
  const patch = {
    ovQuota: quota,
    ovQuotaUpdatedAt: now,
    ovQuotaSource: 'yesone',
    updatedAt: now,
  };
  if (used != null && used >= 0) patch.ovQuotaUsed = used;
  if (period) patch.ovQuotaPeriod = period;
  await db.doc(`users/${rc.id}`).set(patch, { merge: true });
  return {
    ok: true,
    event: 'rc.ov_quota',
    id: rc.id,
    rcCode: rc.rcCode || null,
    ovQuota: quota,
    ovQuotaUsed: used,
    ovQuotaPeriod: period,
  };
}

async function applyInboundItem(db, item) {
  const event = inferEventName(item);
  if (!event) return { ok: false, event: 'unknown', error: 'event_required' };
  if (event === 'serial.allotted') return applySerialAllotted(db, item);
  if (event === 'serial.updated') return applySerialUpdated(db, item);
  if (event === 'serial.cancelled') return applySerialCancelled(db, item);
  if (event === 'rc.ov_quota') return applyOvQuota(db, item);
  return { ok: false, event, error: 'event_unsupported' };
}

function plainInboundLogRows(at, results, log) {
  const rows = Array.isArray(results) ? results : [];
  if (rows.length === 0) {
    const error = optionalTrimmed(log.error);
    return [{
      id: `log_${at}`,
      at,
      ok: log.ok === true,
      event: optionalTrimmed(log.event) || 'inbound',
      detail: error || (log.ok ? 'ok' : 'failed'),
      ...(error ? { error } : {}),
    }];
  }
  return rows.map((result, index) => {
    const error = optionalTrimmed(result.error);
    const id = optionalTrimmed(result.id) || `${at}_${index}`;
    const detail = [
      optionalTrimmed(result.id),
      optionalTrimmed(result.rcCode),
      optionalTrimmed(result.warning),
      error,
    ].filter(Boolean).join(' · ');
    return {
      id,
      at,
      ok: result.ok === true,
      event: optionalTrimmed(result.event) || optionalTrimmed(log.event) || 'inbound',
      detail: detail || (result.ok === true ? 'ok' : 'failed'),
      ...(error ? { error } : {}),
    };
  });
}

async function writeInboundLog(db, log, results) {
  const ref = db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`);
  const snap = await ref.get();
  const prev = Array.isArray(snap.data()?.yesoneInboundLogs) ? snap.data().yesoneInboundLogs : [];
  const next = [...prev, ...plainInboundLogRows(log.at, results, log)].slice(-INBOUND_LOG_LIMIT);
  await ref.set(
    {
      yesoneLastInboundAt: log.at,
      yesoneLastInboundLog: log,
      yesoneInboundLogs: next,
      updatedAt: log.at,
    },
    { merge: true },
  );
}

async function storeInboundEvent(db, eventId, payload, results, ok) {
  const id = optionalTrimmed(eventId) || `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  await db.doc(`${INBOUND_EVENTS_COLLECTION}/${id}`).set({
    id,
    at: new Date().toISOString(),
    ok,
    source: 'yesone',
    payload: compactPayload(payload),
    results,
  });
  return id;
}

async function yesoneInboundHttpHandler(req, res, db) {
  setInboundCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const body = readJsonBody(req);
  const expected = await loadInboundToken(db);
  if (!expected) {
    res.status(503).json({ ok: false, error: 'inbound_not_configured' });
    return;
  }
  const provided = readInboundToken(req, body);
  if (!secretsEqual(provided, expected)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      service: 'yesgatc-yesone-inbound',
      events: ['serial.allotted', 'serial.updated', 'serial.cancelled', 'rc.ov_quota'],
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST or GET only.' });
    return;
  }

  const items = expandInboundItems(body);
  if (items.length === 0 || (items.length === 1 && !inferEventName(items[0]) && Object.keys(items[0]).length === 0)) {
    res.status(400).json({ ok: false, error: 'empty_payload' });
    return;
  }

  const results = [];
  for (const item of items) {
    try {
      results.push(await applyInboundItem(db, item));
    } catch (err) {
      results.push({
        ok: false,
        event: inferEventName(item) || 'unknown',
        error: err instanceof Error ? err.message : 'inbound_failed',
      });
    }
  }

  const ok = results.every(item => item.ok);
  const at = new Date().toISOString();
  const primary = results[0];
  const log = {
    at,
    ok,
    event: primary?.event || 'unknown',
    count: results.length,
    error: ok ? undefined : results.find(item => !item.ok)?.error,
  };

  try {
    await storeInboundEvent(db, optionalTrimmed(body.id || body.eventId), body, results, ok);
    await writeInboundLog(db, log, results);
  } catch (err) {
    console.error('yesone inbound log failed', err);
  }

  res.status(200).json({ ok, at, results });
}

module.exports = {
  normalizeEventName,
  inferEventName,
  expandInboundItems,
  readSerialNumber,
  readPreviousSerial,
  readQuotaValue,
  serialDocId,
  yesoneInboundHttpHandler,
};
