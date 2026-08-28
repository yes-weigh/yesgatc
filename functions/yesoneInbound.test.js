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
          return {
            limit(n) {
              return {
                async get() {
                  const docs = Object.entries(store)
                    .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
                    .filter(([, data]) => matches(data, field, op, value))
                    .slice(0, n)
                    .map(([path, data]) => ({
                      id: path.slice(name.length + 1),
                      data: () => data,
                      ref: doc(path),
                    }));
                  return { empty: docs.length === 0, docs };
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
  assert.equal(dumpAllotted.filter(item => item.rcCode === 'IWP').length, 767);
  assert.equal(yesoneDump.find(item => item.serialNumber === 'Y10315')?.rcCode, 'IWP');
  assert.equal(yesoneDump.find(item => item.serialNumber === 'YZ01420')?.rcCode, 'IWP');
  assert.equal(yesoneDump.find(item => item.serialNumber === 'X00001'), undefined);
  assert.equal(yesoneDump.find(item => item.serialNumber === 'G0003'), undefined);
  assert.equal(yesoneDump[0].rcId, null);
  assert.equal(yesoneDump.some(item => item.event === 'rc.ov_quota' && item.ov === 40), true);
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

test('unused series go to master RC IWP; OV quota skipped for IWP', async () => {
  const db = createMemoryDb({
    'appSettings/global': { yesoneInboundToken: 'tok_live_aaaaaaaaaaaaaaaa' },
    'users/rc1': { role: 'rc_admin', rcCode: 'ABC', companyName: 'Meezan' },
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
        allotments: [{
          from: 'X00001',
          to: 'X00004',
          qty: 4,
          serialNumbers: ['X00001'],
        }],
        generatedSerialDetails: [
          { serial: 'X00001', rcCode: 'ABC', rcName: 'Meezan' },
        ],
        generatedSerialBackfill: [{ from: 'Y00001', to: 'Y00002', unused: 2, qty: 2 }],
        rcOvQuota: [
          { rcCode: 'ABC', ov: 1, linked: 1, sold: 10 },
          { rcCode: 'IWP', ov: 9, linked: 0, sold: 99 },
        ],
      },
    },
    res,
    db,
  );

  assert.equal(res.body.ok, true);
  assert.equal(db._store['serialAllotments/X00001'].rcId, 'rc1');
  assert.equal(db._store['serialAllotments/X00002'], undefined);
  assert.equal(db._store['serialAllotments/Y00001'], undefined);
  assert.equal(db._store['serialAllotments/Y10315'].rcId, 'iwp');
  assert.equal(db._store['serialAllotments/YZ01420'].rcId, 'iwp');
  assert.equal(db._store['users/iwp'].ovQuota, 767);
  assert.equal(db._store['users/iwp'].ovQuotaUsed, undefined);
  assert.ok(!db._store['users/iwp'].yesoneAllottedSerials.includes('X00001'));
  assert.ok(db._store['users/iwp'].yesoneAllottedSerials.includes('Y10315'));
  assert.equal(db._store['users/rc1'].ovQuota, 10);
  assert.equal(db._store['users/rc1'].ovQuotaUsed, 1);
});
