const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('./yesoneInbound');

function createMemoryDb(seed = {}) {
  const store = { ...seed };
  let seq = 0;

  function doc(path) {
    return {
      id: path.split('/').pop(),
      path,
      async get() {
        const data = store[path];
        return { exists: data != null, id: path.split('/').pop(), data: () => data, ref: doc(path) };
      },
      async set(data, opts) {
        store[path] = opts?.merge ? { ...store[path], ...data } : { ...data };
      },
      async update(data) {
        store[path] = { ...store[path], ...data };
      },
    };
  }

  function matches(data, field, op, value) {
    if (!data) return false;
    if (op === '==') return data[field] === value;
    return false;
  }

  return {
    _store: store,
    doc,
    collection(name) {
      return {
        async add(data) {
          const id = `auto_${seq += 1}`;
          const path = `${name}/${id}`;
          store[path] = data;
          return doc(path);
        },
        where(field, op, value) {
          const fetch = async (n) => {
            const docs = Object.entries(store)
              .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
              .filter(([, data]) => matches(data, field, op, value))
              .slice(0, n == null ? undefined : n)
              .map(([path, data]) => ({
                id: path.slice(name.length + 1),
                data: () => data,
                ref: doc(path),
              }));
            return { empty: docs.length === 0, docs };
          };
          return {
            async get() {
              return fetch();
            },
            limit(n) {
              return {
                async get() {
                  return fetch(n);
                },
              };
            },
          };
        },
      };
    },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('serial event aliases and payload expand', () => {
  assert.equal(normalizeEventName('serial allotment'), 'serial.allotted');
  assert.equal(normalizeEventName('OV_QUOTA'), 'rc.ov_quota');
  assert.equal(readSerialNumber({ serial: { number: 'Y1001' } }), 'Y1001');
  assert.equal(readPreviousSerial({ from: 'Y1', serialNumber: 'Y2' }), 'Y1');
  assert.equal(readQuotaValue({ quota: 12 }), 12);
  assert.equal(readQuotaValue({ sold: 1130, ov: 599, linked: 596 }), 1130);
  assert.equal(readQuotaUsed({ sold: 1130, ov: 599, linked: 596 }), 596);
  assert.equal(serialDocId('ab/cd'), 'AB_CD');
  assert.equal(inferEventName({ serialNumber: 'Y1', rcCode: 'ABC' }), 'serial.allotted');
  const items = expandInboundItems({
    event: 'serial.allotted',
    rcCode: 'ABC',
    serials: ['Y1', 'Y2'],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].serialNumber, 'Y1');
  assert.equal(items[0].rcCode, 'ABC');

  const rcBundle = expandInboundItems({
    generatedSerials: ['G1'],
    rcs: [
      { rcCode: 'ABC', serials: ['A1', 'A2'], ov: 40, sold: 3 },
    ],
  });
  assert.equal(rcBundle.some(item => item.serialNumber === 'G1'), true);
  assert.equal(rcBundle.filter(item => item.event === 'serial.allotted' && item.rcCode === 'ABC').length, 2);
  assert.equal(rcBundle.some(item => item.event === 'rc.ov_quota' && item.rcCode === 'ABC'), true);

  assert.deepEqual(expandSerialRange('G0001', 'G0003'), ['G0001', 'G0002', 'G0003']);
  assert.deepEqual(expandSerialRange('X00001', 'X00003'), ['X00001', 'X00002', 'X00003']);
  assert.equal(expandSerialRange('X00001', 'X01000').length, 1000);
  assert.equal(expandSerialRange('Y10315', 'Y11000').length, 686);
  assert.equal(expandSerialRange('YZ01420', 'YZ01500').length, 81);

  const yesoneDump = expandInboundItems({
    event: 'serial_allotment',
    allotments: [{
      id: 'range-uuid',
      from: 'G0001',
      to: 'G0003',
      qty: 3,
      serialNumbers: ['G0001'],
    }],
    generatedSerialDetails: [
      { serial: 'G0001', rcCode: 'ABC', rcName: 'Meezan' },
      { serial: 'G0002', rcCode: 'ABC', rcName: 'Meezan' },
    ],
    rcOvQuota: [{ rcCode: 'ABC', ov: 40, linked: 3, sold: 10, pending: 7 }],
  });
  const dumpAllotted = yesoneDump.filter(item => item.event === 'serial.allotted');
  assert.equal(dumpAllotted.filter(item => item.rcCode === 'ABC').length, 2);
  assert.equal(dumpAllotted.filter(item => item.rcCode === 'IWP').length, 0);
  assert.equal(yesoneDump.find(item => item.serialNumber === 'Y10315'), undefined);
  assert.equal(yesoneDump.find(item => item.serialNumber === 'YZ01420'), undefined);
  assert.equal(yesoneDump.find(item => item.serialNumber === 'X00001'), undefined);
  assert.equal(yesoneDump.find(item => item.serialNumber === 'G0003'), undefined);
  assert.equal(yesoneDump[0].rcId, null);
  assert.equal(yesoneDump.some(item => item.event === 'rc.ov_quota' && item.ov === 40), true);
});

test('cancel and allot expand serials list, aliases, from-to', () => {
  const events = expandInboundItems({
    events: [
      { event: 'serial.cancelled', serials: ['G0540'] },
      { event: 'serial.cancelled', serialNo: 'G0541' },
    ],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'serial.cancelled');
  assert.equal(events[0].serialNumber, 'G0540');
  assert.equal(events[1].event, 'serial.cancelled');
  assert.equal(events[1].serialNumber, 'G0541');

  const range = expandInboundItems({
    event: 'serial.cancelled',
    from: 'G0540',
    to: 'G0541',
  });
  assert.deepEqual(range.map(item => item.serialNumber), ['G0540', 'G0541']);
  assert.equal(range.every(item => item.event === 'serial.cancelled'), true);

  const allot = expandInboundItems({
    event: 'serial.allotted',
    serials: ['G0540', 'G0541'],
    rcCode: 'KNR',
  });
  assert.equal(allot.filter(item => item.event === 'serial.allotted').length, 2);
  assert.equal(readSerialNumber({ serial: { id: 'G0540' } }), 'G0540');
});

test('nested series/rc and PascalCase cancel+allot', () => {
  const cancelled = expandInboundItems({
    event: 'serial.cancelled',
    series: { from: 'G0540', to: 'G0541' },
    rc: { rcCode: 'MZN' },
    allotments: [{ from: 'G0540', to: 'G0541', qty: 2 }],
    invoice: { id: 'inv-1' },
  });
  assert.deepEqual(cancelled.map(item => item.serialNumber), ['G0540', 'G0541']);
  assert.equal(cancelled.every(item => item.event === 'serial.cancelled'), true);
  assert.equal(cancelled[0].rcCode, 'MZN');

  const pascal = expandInboundItems({
    Event: 'Serial.Cancelled',
    Series: { From: 'G0540', To: 'G0541' },
    Rc: { RcCode: 'KNR' },
  });
  assert.deepEqual(pascal.map(item => item.serialNumber), ['G0540', 'G0541']);
  assert.equal(pascal.every(item => item.event === 'serial.cancelled'), true);
  assert.equal(pascal[0].rcCode, 'KNR');

  const allotted = expandInboundItems({
    event: 'serial.allotted',
    series: { from: 'G0540', to: 'G0541' },
    rc: { rcCode: 'KNR' },
  });
  assert.deepEqual(allotted.map(item => item.serialNumber), ['G0540', 'G0541']);
  assert.equal(allotted[0].event, 'serial.allotted');
  assert.equal(allotted[0].rcCode, 'KNR');

  const dashed = expandInboundItems({
    event: 'serial.cancelled',
    series: 'G0540-G0541',
    rc: { rcCode: 'MZN' },
  });
  assert.deepEqual(dashed.map(item => item.serialNumber), ['G0540', 'G0541']);

  const withItems = expandInboundItems({
    event: 'serial.cancelled',
    series: { from: 'G0540', to: 'G0541' },
    items: Array.from({ length: 8 }, (_, i) => ({ id: i, qty: 1 })),
  });
  assert.deepEqual(withItems.map(item => item.serialNumber), ['G0540', 'G0541']);
});

test('dump root unused qty does not become another RC allotted', () => {
  const withSold = expandInboundItems({
    generatedSerialDetails: [{ serial: 'Y02159', rcCode: 'MZN', rcName: 'Meezan' }],
    sold: 767,
    allotted: 767,
    rcOvQuota: [{ rcCode: 'MZN', ov: 548, linked: 548, sold: 582 }],
  });
  const quota = withSold.find(item => item.event === 'rc.ov_quota' && item.rcCode === 'MZN');
  assert.equal(readQuotaValue(quota), 582);

  const inherited = expandInboundItems({
    generatedSerialDetails: [{ serial: 'Y02159', rcCode: 'MZN' }],
    sold: 767,
    allotted: 767,
    rcOvQuota: [{ rcCode: 'MZN', ov: 548, linked: 548 }],
  });
  const row = inherited.find(item => item.event === 'rc.ov_quota' && item.rcCode === 'MZN');
  assert.notEqual(readQuotaValue(row), 767);
});

test('sold qty is not stored as a serial', () => {
  const items = expandInboundItems({
    rcs: [
      { rcCode: 'ATL', sold: 1130, ov: 589, allotted: 1130 },
      { rcCode: 'DYI', sold: 306, ov: 298, allotted: 306 },
      { rcCode: 'KSR', sold: 119, ov: 100, allotted: 119 },
    ],
  });
  assert.equal(items.some(item => String(item.serialNumber || '') === '1130'), false);
  assert.equal(items.some(item => String(item.serialNumber || '') === '306'), false);
  assert.equal(items.some(item => String(item.serialNumber || '') === '119'), false);
  assert.equal(readQuotaValue(items.find(item => item.event === 'rc.ov_quota' && item.rcCode === 'ATL')), 1130);
  assert.equal(readQuotaValue(items.find(item => item.event === 'rc.ov_quota' && item.rcCode === 'DYI')), 306);
  assert.equal(readQuotaValue(items.find(item => item.event === 'rc.ov_quota' && item.rcCode === 'KSR')), 119);
});

test('inbound GET and POST serial + quota', async () => {
  const db = createMemoryDb({
    'appSettings/global': { yesoneInboundToken: 'tok_live_aaaaaaaaaaaaaaaa' },
    'users/rc1': { role: 'rc_admin', rcCode: 'ABC', companyName: 'Meezan' },
    'users/iwp': { role: 'rc_admin', rcCode: 'IWP', companyName: 'INTERWEIGHING PVT LTD' },
    'siteCalibrations/draft1': { serialNumber: 'Y1', status: 'draft', rcId: 'rc1' },
    'siteCalibrations/cert1': {
      serialNumber: 'Y1',
      status: 'certified',
      certificateNumber: 'IND/GATC/KL/26/04/26/12',
    },
  });

  const unauthorized = mockRes();
  await yesoneInboundHttpHandler(
    { method: 'GET', query: {}, headers: {}, get: () => '', body: {} },
    unauthorized,
    db,
  );
  assert.equal(unauthorized.statusCode, 401);

  const health = mockRes();
  await yesoneInboundHttpHandler(
    { method: 'GET', query: { token: 'tok_live_aaaaaaaaaaaaaaaa' }, headers: {}, get: () => '', body: {} },
    health,
    db,
  );
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.ok, true);

  const allotted = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: { event: 'serial.allotted', serialNumber: 'Y9', rcCode: 'ABC' },
    },
    allotted,
    db,
  );
  assert.equal(allotted.body.ok, true);
  assert.equal(db._store['serialAllotments/Y9'].status, 'allotted');
  assert.equal(db._store['serialAllotments/Y9'].rcId, 'rc1');
  assert.deepEqual(db._store['users/rc1'].yesoneAllottedSerials, ['Y9']);

  const bulk = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: { event: 'serial.allotted', rcCode: 'ABC', serials: ['B1', 'B2'] },
    },
    bulk,
    db,
  );
  assert.equal(bulk.body.ok, true);
  assert.equal(db._store['serialAllotments/B1'].rcId, 'rc1');
  assert.equal(db._store['serialAllotments/B2'].rcId, 'rc1');
  assert.ok(db._store['users/rc1'].yesoneAllottedSerials.includes('B1'));
  assert.ok(db._store['users/rc1'].yesoneAllottedSerials.includes('B2'));

  const quota = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: { event: 'rc.ov_quota', rcCode: 'ABC', ovQuota: 40, used: 3, period: '2026-08' },
    },
    quota,
    db,
  );
  assert.equal(quota.body.ok, true);
  assert.equal(db._store['users/rc1'].ovQuota, 40);
  assert.equal(db._store['users/rc1'].ovQuotaUsed, 3);

  const updated = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: { event: 'serial.updated', previousSerialNumber: 'Y1', serialNumber: 'Y2' },
    },
    updated,
    db,
  );
  assert.equal(updated.body.ok, true);
  assert.equal(db._store['siteCalibrations/draft1'].serialNumber, 'Y2');
  assert.equal(db._store['siteCalibrations/cert1'].serialNumber, 'Y1');
  assert.equal(db._store['serialAllotments/Y2'].previousSerialNumber, 'Y1');
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs.length, 5);
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[0].event, 'serial.allotted');
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[0].ok, true);
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[3].event, 'rc.ov_quota');
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[4].event, 'serial.updated');

  const yesoneLive = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: {
        event: 'serial_allotment',
        allotments: [{
          id: 'b21f76db-f5c6-4b3a-8d57-3efd60a12aa7',
          from: 'G0001',
          to: 'G0002',
          qty: 2,
          serialNumbers: ['G0001', 'G0002'],
        }],
        generatedSerialDetails: [
          { serial: 'G0001', rcCode: 'ABC', rcName: 'Meezan' },
          { serial: 'G0002', rcCode: 'ABC', rcName: 'Meezan' },
        ],
        rcOvQuota: [{ rcCode: 'ABC', ov: 40, linked: 3, sold: 10, pending: 7 }],
      },
    },
    yesoneLive,
    db,
  );
  assert.equal(yesoneLive.body.ok, true);
  assert.equal(db._store['serialAllotments/G0001'].rcId, 'rc1');
  assert.equal(db._store['serialAllotments/G0001'].rcCode, 'ABC');
  assert.equal(db._store['users/rc1'].ovQuota, 10);
  assert.equal(db._store['users/rc1'].ovQuotaUsed, 3);
  assert.ok(db._store['users/rc1'].yesoneAllottedSerials.includes('G0001'));
  assert.ok(db._store['appSettings/global'].yesoneLastInboundLog.ok);
});

test('Allotted from Yesone sold; unused Y/YZ not injected', async () => {
  const db = createMemoryDb({
    'appSettings/global': { yesoneInboundToken: 'tok_live_aaaaaaaaaaaaaaaa' },
    'users/rc1': { role: 'rc_admin', rcCode: 'MZN', companyName: 'Meezan' },
    'users/iwp': { role: 'rc_admin', rcCode: 'IWP', companyName: 'INTERWEIGHING PVT LTD' },
  });

  const res = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: {
        event: 'serial_allotment',
        generatedSerialDetails: [
          { serial: 'Y02159', rcCode: 'MZN', rcName: 'Meezan' },
        ],
        rcOvQuota: [
          { rcCode: 'IWP', ov: 0, linked: 0, sold: 0 },
          { rcCode: 'MZN', ov: 548, linked: 548, sold: 582 },
        ],
      },
    },
    res,
    db,
  );

  assert.equal(res.body.ok, true);
  assert.equal(db._store['serialAllotments/Y10315'], undefined);
  assert.equal(db._store['users/iwp'].ovQuota, 767);
  assert.equal(db._store['users/rc1'].ovQuota, 582);
  assert.equal(db._store['users/rc1'].ovQuotaUsed, 548);
  const iwpSerials = db._store['users/iwp'].yesoneAllottedSerials;
  assert.equal(iwpSerials.length, 767);
  assert.ok(iwpSerials.includes('Y10315'));
  assert.ok(iwpSerials.includes('Y11000'));
  assert.ok(iwpSerials.includes('YZ01420'));
  assert.ok(iwpSerials.includes('YZ01500'));
});

test('unused Y/YZ pool leaves Meezan and allots to IWP', async () => {
  const db = createMemoryDb({
    'appSettings/global': { yesoneInboundToken: 'tok_live_aaaaaaaaaaaaaaaa' },
    'users/rc1': {
      role: 'rc_admin',
      rcCode: 'MZN',
      companyName: 'Meezan',
      yesoneAllottedSerials: ['Y10626', 'Y02159', 'G0001'],
    },
    'users/iwp': { role: 'rc_admin', rcCode: 'IWP', companyName: 'INTERWEIGHING PVT LTD' },
    'serialAllotments/Y10626': { serialNumber: 'Y10626', rcId: 'rc1', rcCode: 'MZN', status: 'allotted' },
  });

  const tagged = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: {
        event: 'serial.allotted',
        serialNumber: 'Y10626',
        rcCode: 'MZN',
        rcName: 'Meezan',
      },
    },
    tagged,
    db,
  );

  assert.equal(tagged.body.ok, true);
  assert.equal(db._store['serialAllotments/Y10626'].rcId, 'iwp');
  assert.equal(db._store['serialAllotments/Y10626'].rcCode, 'IWP');
  assert.ok(db._store['users/iwp'].yesoneAllottedSerials.includes('Y10626'));
  assert.ok(db._store['users/iwp'].yesoneAllottedSerials.includes('YZ01420'));
  assert.equal(db._store['users/iwp'].yesoneAllottedSerials.length, 767);
  assert.equal(db._store['users/iwp'].ovQuota, 767);
  assert.deepEqual(db._store['users/rc1'].yesoneAllottedSerials.sort(), ['G0001', 'Y02159']);
});

test('POST cancel then allot nested series to KNR', async () => {
  const db = createMemoryDb({
    'appSettings/global': { yesoneInboundToken: 'tok_live_aaaaaaaaaaaaaaaa' },
    'users/mzn': {
      role: 'rc_admin',
      rcCode: 'MZN',
      companyName: 'Meezan',
      yesoneAllottedSerials: ['G0540', 'G0541'],
    },
    'users/knr': { role: 'rc_admin', rcCode: 'KNR', companyName: 'ROYAL SCALES' },
    'serialAllotments/G0540': { serialNumber: 'G0540', rcId: 'mzn', rcCode: 'MZN', status: 'allotted' },
    'serialAllotments/G0541': { serialNumber: 'G0541', rcId: 'mzn', rcCode: 'MZN', status: 'allotted' },
  });

  const cancel = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: {
        event: 'serial.cancelled',
        series: { from: 'G0540', to: 'G0541' },
        rc: { rcCode: 'MZN' },
      },
    },
    cancel,
    db,
  );
  assert.equal(cancel.body.ok, true);
  assert.equal(cancel.body.results.length, 2);
  assert.equal(db._store['serialAllotments/G0540'].status, 'cancelled');
  assert.equal(db._store['serialAllotments/G0541'].status, 'cancelled');
  assert.equal(db._store['users/mzn'].yesoneAllottedSerials.includes('G0540'), false);
  assert.equal(db._store['users/mzn'].yesoneAllottedSerials.includes('G0541'), false);

  const allot = mockRes();
  await yesoneInboundHttpHandler(
    {
      method: 'POST',
      query: { token: 'tok_live_aaaaaaaaaaaaaaaa' },
      headers: {},
      get: () => '',
      body: {
        event: 'serial.allotted',
        series: { from: 'G0540', to: 'G0541' },
        rc: { rcCode: 'KNR' },
      },
    },
    allot,
    db,
  );
  assert.equal(allot.body.ok, true);
  assert.equal(db._store['serialAllotments/G0540'].rcId, 'knr');
  assert.equal(db._store['serialAllotments/G0540'].rcCode, 'KNR');
  assert.equal(db._store['serialAllotments/G0541'].rcId, 'knr');
  assert.ok(db._store['users/knr'].yesoneAllottedSerials.includes('G0540'));
  assert.ok(db._store['users/knr'].yesoneAllottedSerials.includes('G0541'));
});
