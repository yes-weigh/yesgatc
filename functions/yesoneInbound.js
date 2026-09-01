const crypto = require('crypto');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';
const SERIAL_COLLECTION = 'serialAllotments';
const INBOUND_EVENTS_COLLECTION = 'yesoneInboundEvents';
const INBOUND_LOG_LIMIT = 200;
const MAX_EVENTS = 8000;
const MASTER_RC_CODE = 'IWP';
const MASTER_UNUSED_RANGES = [
  { from: 'Y10315', to: 'Y11000' },
  { from: 'YZ01420', to: 'YZ01500' },
];
const ISSUED_VERIFICATION_STATUSES = new Set(['certified', 'approved', 'submitted']);

const EVENT_ALIASES = {
  'serial.allotted': 'serial.allotted',
  'serial.allotment': 'serial.allotted',
  'serial.allocated': 'serial.allotted',
  'serial.created': 'serial.allotted',
  'serial.new': 'serial.allotted',
  new_serial: 'serial.allotted',
  serial_allotment: 'serial.allotted',
  serialallotted: 'serial.allotted',
  serial_allotted: 'serial.allotted',
  'serial.updated': 'serial.updated',
  'serial.changed': 'serial.updated',
  'serial.renamed': 'serial.updated',
  serial_update: 'serial.updated',
  serial_change: 'serial.updated',
  'serial.cancelled': 'serial.cancelled',
  'serial.canceled': 'serial.cancelled',
  'serial.voided': 'serial.cancelled',
  serial_cancelled: 'serial.cancelled',
  serial_canceled: 'serial.cancelled',
  serialcancelled: 'serial.cancelled',
  serialcanceled: 'serial.cancelled',
  cancelled: 'serial.cancelled',
  canceled: 'serial.cancelled',
  cancel: 'serial.cancelled',
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

function firstQueryValue(value) {
  if (Array.isArray(value)) return optionalTrimmed(value[0]);
  return optionalTrimmed(value);
}

function readInboundToken(req, body) {
  const fromQuery = firstQueryValue(req.query?.token || req.query?.key);
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

function pickValue(item, names) {
  const rec = asRecord(item);
  const norm = new Map();
  for (const [key, value] of Object.entries(rec)) {
    norm.set(String(key).toLowerCase().replace(/[_-]/g, ''), value);
  }
  for (const name of names) {
    const value = norm.get(name.toLowerCase().replace(/[_-]/g, ''));
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function pickText(item, names) {
  return optionalTrimmed(pickValue(item, names));
}

function normalizeEventName(raw) {
  const text = String(raw || '').trim();
  const dotted = text.toLowerCase();
  const key = dotted.replace(/[\s.]+/g, '_');
  return EVENT_ALIASES[dotted] || EVENT_ALIASES[key] || EVENT_ALIASES[key.replace(/_/g, '')] || optionalTrimmed(raw);
}

function inferEventName(item) {
  const rec = asRecord(item);
  const named = normalizeEventName(
    pickValue(rec, ['event', 'type', 'kind', 'name']) || pickValue(rec, ['action']),
  );
  if (named) return named;
  if (readPreviousSerial(item) && readSerialNumber(item)) return 'serial.updated';
  if (readQuotaValue(item) != null) return 'rc.ov_quota';
  if (readSerialNumber(item) || Array.isArray(pickValue(rec, ['serials']))) return 'serial.allotted';
  return null;
}

function looksLikeYesoneSerial(value) {
  const text = optionalTrimmed(value);
  return Boolean(text) && /[A-Za-z]/.test(text) && /\d/.test(text);
}

function readSerialNumber(item) {
  const rec = asRecord(item);
  const serial = asRecord(pickValue(rec, ['serial']) || rec.serial);
  const raw = pickText(rec, [
    'serialNumber',
    'newSerialNumber',
    'newSerial',
    'serialNo',
    'serial_no',
    'slNo',
    'stickerNumber',
    'stickerNo',
    'sticker',
    'toSerial',
  ])
    || (typeof rec.serial === 'string' ? optionalTrimmed(rec.serial) : null)
    || pickText(serial, ['number', 'serialNumber', 'id', 'value', 'code']);
  return looksLikeYesoneSerial(raw) ? raw : null;
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
  const sold = firstFiniteAmount([item.sold, item.soldCount, quota.sold]);
  const pending = firstFiniteAmount([item.pending, item.pendingCount, quota.pending]);
  const ov = firstFiniteAmount([item.ov, item.ovCount, quota.ov]);
  const linked = firstFiniteAmount([item.linked, quota.linked]);
  if (
    sold != null
    && (ov != null || linked != null)
    && item.ovQuota == null
    && typeof item.quota !== 'number'
  ) {
    return sold;
  }
  const composed = sold != null && pending != null ? sold + pending + (ov || 0) : null;
  return firstFiniteAmount([
    item.ovQuota,
    typeof item.quota === 'number' ? item.quota : null,
    item.allotted,
    item.limit,
    quota.ovQuota,
    quota.allotted,
    quota.limit,
    ov,
    composed,
  ]);
}

function readQuotaUsed(item) {
  const quota = asRecord(item.quota);
  const sold = firstFiniteAmount([item.sold, item.soldCount, quota.sold]);
  const ov = firstFiniteAmount([item.ov, item.ovCount, quota.ov]);
  const linked = firstFiniteAmount([item.linked, quota.linked]);
  if (
    sold != null
    && (ov != null || linked != null)
    && item.ovQuotaUsed == null
    && item.used == null
  ) {
    return firstFiniteAmount([linked, ov]);
  }
  return firstFiniteAmount([
    item.ovQuotaUsed,
    item.linked,
    item.used,
    item.usedCount,
    quota.linked,
    quota.used,
    item.sold,
    item.ovSold,
    quota.sold,
  ]);
}

function serialValues(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' || typeof value === 'number') return [value];
  return [];
}

function parseSeriesString(value) {
  const text = optionalTrimmed(value);
  if (!text) return {};
  const parts = text.split(/\s*(?:-|–|—|\.\.|to)\s*/i).map(part => part.trim()).filter(Boolean);
  if (parts.length === 2 && looksLikeYesoneSerial(parts[0]) && looksLikeYesoneSerial(parts[1])) {
    return { from: parts[0], to: parts[1] };
  }
  return {};
}

function looksLikeSerialRange(rec) {
  const series = asRecord(pickValue(rec, ['series']));
  const from = rec.from || rec.startNumber || rec.start || series.from || series.start || series.startNumber;
  const to = rec.to || rec.endNumber || rec.end || series.to || series.end || series.endNumber;
  return Boolean(from && to);
}

function withSeriesFields(item) {
  const rec = asRecord(item);
  const seriesRaw = pickValue(rec, ['series']);
  const series = typeof seriesRaw === 'string' || typeof seriesRaw === 'number'
    ? parseSeriesString(seriesRaw)
    : { ...asRecord(seriesRaw), ...parseSeriesString(seriesRaw) };
  const invoice = asRecord(pickValue(rec, ['invoice']));
  const rc = asRecord(pickValue(rec, ['rc']) || rec.rc);
  const from = pickText(rec, ['from', 'start', 'startNumber', 'startSerial', 'serialFrom', 'rangeFrom'])
    || pickText(series, ['from', 'start', 'startNumber', 'startSerial', 'startFrom', 'serialFrom'])
    || pickText(invoice, ['from', 'start', 'startNumber']);
  const to = pickText(rec, ['to', 'end', 'endNumber', 'endSerial', 'serialTo', 'rangeTo'])
    || pickText(series, ['to', 'end', 'endNumber', 'endSerial', 'serialTo'])
    || pickText(invoice, ['to', 'end', 'endNumber']);
  const listed = pickValue(rec, ['serials', 'serialNumbers', 'serial_numbers', 'allottedSerials', 'cancelledSerials'])
    || pickValue(rc, ['serials', 'serialNumbers'])
    || pickValue(series, ['serials', 'serialNumbers'])
    || pickValue(invoice, ['serials', 'serialNumbers']);
  return {
    ...rec,
    from: from || optionalTrimmed(rec.from),
    to: to || optionalTrimmed(rec.to),
    rcCode: rcCodeFrom(rec) || rcCodeFrom(rc),
    rcId: pickText(rec, ['rcId', 'rcUid']) || pickText(rc, ['id', 'uid', 'rcId']),
    rcCompanyName: pickText(rec, ['rcCompanyName', 'rcName', 'companyName', 'dealerName'])
      || pickText(rc, ['name', 'companyName', 'rcName']),
    ...(Array.isArray(listed) ? { serials: listed } : {}),
  };
}

function isYesoneDump(root) {
  return Boolean(
    root.generatedSerialDetails
    || root.rcAllottedSerialDetails
    || root.serialsAllottedToRc
    || Array.isArray(root.rcs)
    || Array.isArray(root.rcOvQuota)
    || Array.isArray(root.quotas)
    || Array.isArray(root.ovQuotas),
  );
}

function serialRequiredError(event, item) {
  const keys = Object.keys(asRecord(item))
    .filter(key => key !== 'token' && key !== 'secret')
    .slice(0, 16)
    .join(',');
  return { ok: false, event, error: keys ? `serial_required:${keys}` : 'serial_required' };
}

function parseSerialParts(value) {
  const text = optionalTrimmed(value);
  if (!text) return null;
  const match = text.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], width: match[2].length, n: BigInt(match[2]) };
}

function expandSerialRange(from, to, missing, max = MAX_EVENTS) {
  const a = parseSerialParts(from);
  const b = parseSerialParts(to);
  if (!a || !b || a.prefix !== b.prefix || b.n < a.n) {
    return [optionalTrimmed(from), optionalTrimmed(to)].filter(Boolean);
  }
  const miss = new Set(serialValues(missing).map(item => String(item).trim()).filter(Boolean));
  const width = Math.max(a.width, b.width);
  const out = [];
  for (let n = a.n; n <= b.n && out.length < max; n += 1n) {
    const serial = `${a.prefix}${n.toString().padStart(width, '0')}`;
    if (!miss.has(serial)) out.push(serial);
  }
  return out;
}

function serialListFromRec(rec) {
  const listed = pickValue(rec, ['serials', 'serialNumbers', 'serial_numbers', 'allottedSerials', 'cancelledSerials']);
  if (Array.isArray(listed)) return listed;
  if (Array.isArray(rec.allotted)) return rec.allotted;
  return [];
}

function explodeItem(item) {
  const rec = withSeriesFields(item);
  const event = inferEventName(rec) || inferEventName(item);
  const listed = serialsFromGroup(rec);
  if (listed.length > 0 && (listed.length > 1 || !readSerialNumber(rec))) {
    return listed.map(serialNumber => ({
      ...rec,
      event: event || 'serial.allotted',
      serialNumber,
      serials: undefined,
      serialNumbers: undefined,
    }));
  }
  const serialNumber = readSerialNumber(rec);
  return [{ ...rec, ...(serialNumber ? { serialNumber } : {}) }];
}

function expandRecordList(rows, base = {}) {
  const out = [];
  for (const row of rows) {
    for (const item of explodeItem({ ...base, ...asRecord(row), events: undefined, items: undefined })) {
      if (out.length >= MAX_EVENTS) return out;
      out.push(item);
    }
  }
  return out;
}

function serialsFromGroup(rec) {
  const flat = withSeriesFields(rec);
  const listed = [];
  for (const serial of serialValues(serialListFromRec(flat))) {
    if (typeof serial === 'string' || typeof serial === 'number') {
      const text = String(serial).trim();
      if (looksLikeYesoneSerial(text)) listed.push(text);
      continue;
    }
    const number = readSerialNumber(asRecord(serial)) || optionalTrimmed(asRecord(serial).serial);
    if (looksLikeYesoneSerial(number)) listed.push(number);
  }
  const unique = [...new Set(listed)];
  const qty = optionalFiniteNumber(flat.qty ?? flat.count ?? rec.qty ?? rec.count);
  const from = flat.from || rec.startNumber || rec.from || rec.start;
  const to = flat.to || rec.endNumber || rec.to || rec.end;
  if (qty != null && unique.length < qty) {
    const expanded = expandSerialRange(from, to, rec.missing).filter(looksLikeYesoneSerial);
    if (expanded.length > unique.length) return expanded;
  }
  if (unique.length > 0) return unique;
  return expandSerialRange(from, to, rec.missing).filter(looksLikeYesoneSerial);
}

function isPrimitiveSerialList(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string' || typeof item === 'number');
}

function rcCodeFrom(rec) {
  const nested = asRecord(pickValue(rec, ['rc']) || rec.rc);
  return pickText(rec, ['rcCode', 'code'])
    || (typeof rec.rc === 'string' ? optionalTrimmed(rec.rc) : null)
    || pickText(nested, ['rcCode', 'code']);
}

const QUOTA_OWN_KEYS = [
  'sold',
  'soldCount',
  'ov',
  'ovCount',
  'linked',
  'allotted',
  'limit',
  'ovQuota',
  'ovQuotaUsed',
  'used',
  'usedCount',
  'quota',
  'pending',
  'pendingCount',
  'ovQuotaPeriod',
  'period',
  'month',
  'fy',
];

function pickOwnQuota(rec) {
  const out = {};
  for (const key of QUOTA_OWN_KEYS) {
    if (rec[key] !== undefined) out[key] = rec[key];
  }
  return out;
}

let masterUnusedQtyCache = null;
function masterUnusedPoolQty() {
  if (masterUnusedQtyCache == null) {
    masterUnusedQtyCache = MASTER_UNUSED_RANGES.reduce(
      (sum, range) => sum + expandSerialRange(range.from, range.to).length,
      0,
    );
  }
  return masterUnusedQtyCache;
}

function isMasterRcCode(value) {
  return normalizeRcCode(value) === MASTER_RC_CODE;
}

function itemHasRcIdentity(item) {
  const rc = asRecord(item.rc);
  return Boolean(
    optionalTrimmed(item.rcId || item.rcUid || rc.id || rc.uid)
    || normalizeRcCode(item.rcCode || rc.rcCode || rc.code)
    || optionalTrimmed(item.aadhar || item.rcAadhar || rc.aadhar),
  );
}

function serialInRange(serial, from, to) {
  const s = parseSerialParts(serial);
  const a = parseSerialParts(from);
  const b = parseSerialParts(to);
  if (!s || !a || !b || s.prefix !== a.prefix) return false;
  return s.n >= a.n && s.n <= b.n;
}

function isMasterPoolSerial(serial) {
  const text = optionalTrimmed(serial);
  if (!text) return false;
  return MASTER_UNUSED_RANGES.some(range => serialInRange(text, range.from, range.to));
}

function pushSerialItems(out, base, serials, extra = {}) {
  for (const serial of serialValues(serials)) {
    if (out.length >= MAX_EVENTS) return;
    if (typeof serial === 'string' || typeof serial === 'number') {
      const serialNumber = String(serial).trim();
      if (!looksLikeYesoneSerial(serialNumber)) continue;
      out.push({
        ...base,
        ...extra,
        event: extra.event || 'serial.allotted',
        serialNumber,
        serials: undefined,
      });
      continue;
    }
    const row = asRecord(serial);
    const serialNumber = readSerialNumber(row) || optionalTrimmed(row.serial);
    if (!looksLikeYesoneSerial(serialNumber)) continue;
    out.push({
      ...base,
      ...row,
      ...extra,
      event: extra.event || inferEventName({ ...row, ...extra }) || 'serial.allotted',
      serialNumber,
      serials: undefined,
    });
  }
}

function pushDetailSerials(out, base, rows) {
  for (const row of rows) {
    if (out.length >= MAX_EVENTS) return;
    const rec = asRecord(row);
    const serialNumber = optionalTrimmed(rec.serial) || readSerialNumber(rec);
    if (!looksLikeYesoneSerial(serialNumber)) continue;
    out.push({
      ...base,
      ...rec,
      event: 'serial.allotted',
      serialNumber,
      rcCode: rcCodeFrom(rec),
      rcCompanyName: optionalTrimmed(rec.rcName || rec.rcCompanyName || rec.dealerName),
      rcId: optionalTrimmed(rec.rcId || rec.rcUid),
      serials: undefined,
    });
  }
}

function expandRcRows(out, base, rows) {
  for (const row of rows) {
    if (out.length >= MAX_EVENTS) return;
    const rec = asRecord(row);
    const rcCode = rcCodeFrom(rec);
    const extra = {
      ...rec,
      rcCode,
      rcCompanyName: optionalTrimmed(rec.rcName || rec.rcCompanyName || rec.name),
      rcId: optionalTrimmed(rec.rcId || rec.uid) || (rcCode || looksLikeSerialRange(rec) ? null : optionalTrimmed(rec.id)),
    };
    const serials = serialsFromGroup(rec);
    if (serials.length) pushSerialItems(out, base, serials, extra);
    const ownQuota = pickOwnQuota(rec);
    if (readQuotaValue(ownQuota) != null) {
      out.push({
        event: 'rc.ov_quota',
        rcCode,
        rcCompanyName: extra.rcCompanyName,
        rcId: extra.rcId,
        ...ownQuota,
      });
    }
  }
}

const SERIAL_MUTATION_EVENTS = new Set(['serial.allotted', 'serial.cancelled']);

function expandNamedSerialEvent(root, mergedRoot, named) {
  const out = [];
  const base = withSeriesFields({ ...mergedRoot, event: named });
  const allotments = pickValue(root, ['allotments']);
  if (Array.isArray(allotments) && allotments.length) {
    for (const row of allotments) {
      const raw = asRecord(row);
      const inheritSeries = !looksLikeSerialRange(raw)
        && !pickValue(raw, ['series'])
        && serialListFromRec(raw).length === 0;
      const rec = withSeriesFields({
        event: named,
        ...(inheritSeries ? { series: mergedRoot.series, from: base.from, to: base.to } : {}),
        rc: pickValue(raw, ['rc']) || mergedRoot.rc,
        ...raw,
      });
      const serials = serialsFromGroup(rec);
      if (serials.length) {
        pushSerialItems(out, mergedRoot, serials, {
          event: named,
          rcCode: rec.rcCode || base.rcCode,
          rcId: rec.rcId || base.rcId,
          rcCompanyName: rec.rcCompanyName || base.rcCompanyName,
        });
      }
    }
    if (out.length) return out;
  }
  const serials = serialsFromGroup(base);
  if (serials.length) {
    pushSerialItems(out, mergedRoot, serials, {
      event: named,
      rcCode: base.rcCode,
      rcId: base.rcId,
      rcCompanyName: base.rcCompanyName,
    });
  }
  return out;
}

function expandInboundItems(body) {
  const root = asRecord(body);
  const data = asRecord(root.data);
  const mergedRoot = { ...root, ...data };
  const eventRows = root.events;
  const itemRows = root.items;
  delete mergedRoot.data;
  delete mergedRoot.token;
  delete mergedRoot.secret;
  delete mergedRoot.events;
  delete mergedRoot.items;

  const named = inferEventName(mergedRoot);
  if (SERIAL_MUTATION_EVENTS.has(named) && !isYesoneDump(root)) {
    const namedItems = expandNamedSerialEvent(root, mergedRoot, named);
    if (namedItems.length) return namedItems.slice(0, MAX_EVENTS);
  }

  if (Array.isArray(body)) return expandRecordList(body);
  if (Array.isArray(eventRows)) return expandRecordList(eventRows, mergedRoot);
  if (Array.isArray(itemRows)) return expandRecordList(itemRows, mergedRoot);

  const out = [];
  const details = root.generatedSerialDetails || root.rcAllottedSerialDetails;
  if (Array.isArray(details)) pushDetailSerials(out, mergedRoot, details);

  if (!Array.isArray(details) && Array.isArray(root.serialsAllottedToRc)) {
    expandRcRows(out, mergedRoot, root.serialsAllottedToRc);
  }

  const rcRows = root.rcs
    || root.centres
    || root.rcAllotments
    || (Array.isArray(root.allotted) ? root.allotted : null);
  if (Array.isArray(rcRows)) expandRcRows(out, mergedRoot, rcRows);

  if (Array.isArray(root.allotments)) {
    const asRc = root.allotments.filter(row => {
      const rec = asRecord(row);
      return Boolean(rcCodeFrom(rec) || (rec.serials && !looksLikeSerialRange(rec)));
    });
    if (asRc.length) expandRcRows(out, mergedRoot, asRc);
  }

  const allottedMap = !Array.isArray(root.allotted) && asRecord(root.allotted);
  const serialsByRc = asRecord(root.serialsByRc || root.rcSerials);
  const maps = [allottedMap, serialsByRc];
  for (const map of maps) {
    for (const [key, serials] of Object.entries(map)) {
      if (!key || key === 'event' || key === 'type') continue;
      pushSerialItems(out, mergedRoot, serials, { rcCode: key });
    }
  }

  if (isPrimitiveSerialList(root.serials)) {
    pushSerialItems(out, mergedRoot, root.serials, {
      event: inferEventName(mergedRoot) || 'serial.allotted',
    });
  }
  const generated = root.generatedSerials || root.generated || root.newSerials;
  if (isPrimitiveSerialList(generated)) {
    pushSerialItems(out, mergedRoot, generated);
  }

  const quotaRows = root.rcOvQuota || root.quotas || root.ovQuotas;
  if (Array.isArray(quotaRows)) {
    for (const row of quotaRows) {
      if (out.length >= MAX_EVENTS) break;
      const rec = asRecord(row);
      out.push({
        event: 'rc.ov_quota',
        rcCode: rcCodeFrom(rec) || rcCodeFrom(mergedRoot),
        rcId: optionalTrimmed(rec.rcId || rec.uid || mergedRoot.rcId),
        rcCompanyName: optionalTrimmed(rec.rcName || rec.rcCompanyName || rec.name),
        ...pickOwnQuota(rec),
      });
    }
  }

  if (out.length > 0) return out.slice(0, MAX_EVENTS);
  return explodeItem(mergedRoot).slice(0, MAX_EVENTS);
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = stripUndefined(item);
    }
    return out;
  }
  return value;
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
    rcId: rc?.id || null,
    rcCode: normalizeRcCode(rc?.rcCode || item.rcCode) || null,
    rcCompanyName: optionalTrimmed(rc?.companyName || item.rcCompanyName || item.rcName),
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
  const next = mutate(serialList(snap.data()?.yesoneAllottedSerials)).filter(looksLikeYesoneSerial);
  await ref.set(
    {
      yesoneAllottedSerials: next,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

const WRITE_CHUNK = 400;

function rcCacheKey(item) {
  return optionalTrimmed(item.rcId || item.rcUid)
    || normalizeRcCode(item.rcCode)
    || optionalTrimmed(item.aadhar || item.rcAadhar)
    || '';
}

let masterPoolSerialCache = null;

function masterPoolSerials() {
  if (!masterPoolSerialCache) {
    masterPoolSerialCache = MASTER_UNUSED_RANGES.flatMap(range => (
      expandSerialRange(range.from, range.to)
    ));
  }
  return masterPoolSerialCache;
}

async function resolveMasterRc(db, cache) {
  if (cache.has(MASTER_RC_CODE)) return cache.get(MASTER_RC_CODE);
  const snap = await db.collection('users').where('rcCode', '==', MASTER_RC_CODE).limit(4).get();
  const hit = snap.docs.find(doc => doc.data()?.role === 'rc_admin');
  const rc = hit ? { id: hit.id, ...hit.data() } : null;
  cache.set(MASTER_RC_CODE, rc);
  return rc;
}

async function resolveRcCached(db, item, cache) {
  const serial = readSerialNumber(item);
  if (serial && isMasterPoolSerial(serial)) return resolveMasterRc(db, cache);
  if (!itemHasRcIdentity(item)) return null;
  const key = rcCacheKey(item);
  if (key && cache.has(key)) return cache.get(key);
  const rc = await resolveRc(db, item);
  if (key) cache.set(key, rc);
  return rc;
}

async function ensureMasterPoolOnIwp(db, cache) {
  const master = await resolveMasterRc(db, cache);
  if (!master?.id) return;
  const now = new Date().toISOString();
  const pool = masterPoolSerials();
  const rcSnap = await db.collection('users').where('role', '==', 'rc_admin').get();
  const allotmentWrites = [];
  for (const doc of rcSnap.docs) {
    if (doc.id === master.id) continue;
    const stolen = serialList(doc.data()?.yesoneAllottedSerials).filter(isMasterPoolSerial);
    if (!stolen.length) continue;
    await patchRcAllottedSerials(db, doc.id, list => list.filter(serial => !isMasterPoolSerial(serial)));
    for (const serial of stolen) {
      allotmentWrites.push({
        path: `${SERIAL_COLLECTION}/${serialDocId(serial)}`,
        data: {
          serialNumber: serial,
          rcId: master.id,
          rcCode: MASTER_RC_CODE,
          updatedAt: now,
        },
      });
    }
  }
  await patchRcAllottedSerials(db, master.id, list => {
    const next = new Set(list.filter(serial => !isMasterPoolSerial(serial)));
    for (const serial of pool) next.add(serial);
    return [...next];
  });
  await db.doc(`users/${master.id}`).set(
    {
      ovQuota: pool.length,
      ovQuotaUpdatedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  await commitDocSets(db, allotmentWrites);
}

async function commitDocSets(db, writes) {
  if (!writes.length) return;
  if (typeof db.batch === 'function') {
    for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
      const batch = db.batch();
      for (const row of writes.slice(i, i + WRITE_CHUNK)) {
        batch.set(db.doc(row.path), row.data, { merge: true });
      }
      await batch.commit();
    }
    return;
  }
  for (const row of writes) {
    await db.doc(row.path).set(row.data, { merge: true });
  }
}

async function applySerialAllottedMany(db, items, rcCache) {
  const results = [];
  const writes = [];
  const serialsByRc = new Map();
  const now = new Date().toISOString();

  for (const item of items) {
    const serialNumber = readSerialNumber(item);
    if (!serialNumber) {
      results.push(serialRequiredError('serial.allotted', item));
      continue;
    }
    if (!looksLikeYesoneSerial(serialNumber)) {
      results.push({ ok: true, event: 'serial.allotted', id: serialNumber, skipped: 'qty_not_serial' });
      continue;
    }
    const rc = await resolveRcCached(db, item, rcCache);
    const id = serialDocId(serialNumber);
    writes.push({
      path: `${SERIAL_COLLECTION}/${id}`,
      data: allotmentFields(item, rc, serialNumber, {
        status: 'allotted',
        allottedAt: optionalTrimmed(item.allottedAt) || now,
      }),
    });
    if (rc?.id) {
      const list = serialsByRc.get(rc.id) || [];
      list.push(serialNumber);
      serialsByRc.set(rc.id, list);
    }
    results.push({
      ok: true,
      event: 'serial.allotted',
      id: serialNumber,
      rcId: rc?.id || null,
      warning: rc ? null : 'rc_not_found',
    });
  }

  await commitDocSets(db, writes);
  for (const [rcId, serials] of serialsByRc) {
    await patchRcAllottedSerials(db, rcId, list => {
      const next = new Set(list);
      for (const serial of serials) next.add(serial);
      return [...next];
    });
  }
  return results;
}

async function applyInboundItems(db, items) {
  const rcCache = new Map();
  const allotted = [];
  const rest = [];
  for (const item of items) {
    if (inferEventName(item) === 'serial.allotted') allotted.push(item);
    else rest.push(item);
  }

  const results = [];
  if (allotted.length) {
    try {
      results.push(...await applySerialAllottedMany(db, allotted, rcCache));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'inbound_failed';
      for (const item of allotted) {
        results.push({
          ok: false,
          event: 'serial.allotted',
          id: readSerialNumber(item),
          error: message,
        });
      }
    }
  }
  for (const item of rest) {
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
  try {
    await ensureMasterPoolOnIwp(db, rcCache);
  } catch (err) {
    console.error('yesone inbound master pool sync failed', err);
  }
  return results;
}

async function applySerialAllotted(db, item) {
  const serialNumber = readSerialNumber(item);
  if (!serialNumber) return serialRequiredError('serial.allotted', item);
  if (!looksLikeYesoneSerial(serialNumber)) {
    return { ok: true, event: 'serial.allotted', id: serialNumber, skipped: 'qty_not_serial' };
  }
  const cache = new Map();
  const rc = await resolveRcCached(db, item, cache);
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
  if (!serialNumber) return serialRequiredError('serial.cancelled', item);
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
  if (isMasterRcCode(rc.rcCode)) {
    return { ok: true, event: 'rc.ov_quota', id: rc.id, skipped: 'master_rc' };
  }
  if (quota === masterUnusedPoolQty()) {
    return { ok: true, event: 'rc.ov_quota', id: rc.id, skipped: 'master_unused_pool' };
  }
  const allotted = quota;
  const used = readQuotaUsed(item);
  const period = optionalTrimmed(item.ovQuotaPeriod || item.period || item.month || item.fy)
    || optionalTrimmed(asRecord(item.quota).period);
  const now = new Date().toISOString();
  const patch = {
    ovQuota: allotted,
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
    ovQuota: allotted,
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
    stripUndefined({
      yesoneLastInboundAt: log.at,
      yesoneLastInboundLog: log,
      yesoneInboundLogs: next,
      updatedAt: log.at,
    }),
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
    results: Array.isArray(results) ? results.slice(0, 80) : results,
    count: Array.isArray(results) ? results.length : 0,
  });
  return id;
}

async function yesoneInboundHttpHandler(req, res, db) {
  try {
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

    console.log('yesone inbound', {
      keys: Object.keys(asRecord(body)).slice(0, 24),
      items: items.length,
    });

    const results = await applyInboundItems(db, items);

    const ok = results.every(item => item.ok);
    const at = new Date().toISOString();
    const primary = results[0];
    const logRows = results.length > 24
      ? [{
        ok,
        event: primary?.event || 'inbound',
        id: `${results.length}`,
        error: results.find(item => !item.ok)?.error,
      }]
      : results;
    const log = stripUndefined({
      at,
      ok,
      event: primary?.event || 'unknown',
      count: results.length,
      error: ok ? undefined : results.find(item => !item.ok)?.error,
    });

    try {
      await storeInboundEvent(db, optionalTrimmed(body.id || body.eventId), body, results, ok);
      await writeInboundLog(db, log, logRows);
    } catch (err) {
      console.error('yesone inbound log failed', err);
    }

    res.status(200).json({ ok, at, results: results.slice(0, 80), count: results.length });
  } catch (err) {
    console.error('yesone inbound failed', err);
    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'inbound_failed',
      });
    }
  }
}

module.exports = {
  normalizeEventName,
  inferEventName,
  expandInboundItems,
  readSerialNumber,
  readPreviousSerial,
  readQuotaValue,
  readQuotaUsed,
  serialDocId,
  expandSerialRange,
  yesoneInboundHttpHandler,
};
