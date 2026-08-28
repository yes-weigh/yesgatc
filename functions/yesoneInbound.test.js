const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEventName,
  inferEventName,
  expandInboundItems,
  readSerialNumber,
  readPreviousSerial,
  readQuotaValue,
  serialDocId,
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
});

test('inbound GET and POST serial + quota', async () => {
  const db = createMemoryDb({
    'appSettings/global': { yesoneInboundToken: 'tok_live_aaaaaaaaaaaaaaaa' },
    'users/rc1': { role: 'rc_admin', rcCode: 'ABC', companyName: 'Meezan' },
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
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs.length, 3);
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[0].event, 'serial.allotted');
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[0].ok, true);
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[1].event, 'rc.ov_quota');
  assert.equal(db._store['appSettings/global'].yesoneInboundLogs[2].event, 'serial.updated');
});
