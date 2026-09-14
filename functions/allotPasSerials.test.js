const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  allotPasSerialsHandler,
  isGasStickerSerial,
  pasMatchesProduct,
} = require('./allotPasSerials');

function createMemoryDb(seed = {}) {
  const store = { ...seed };

  function doc(path) {
    return {
      id: path.split('/').pop(),
      path,
      async get() {
        const data = store[path];
        return { exists: data != null, id: path.split('/').pop(), data: () => data };
      },
      async set(data, opts) {
        store[path] = opts?.merge ? { ...store[path], ...data } : { ...data };
      },
    };
  }

  return { _store: store, doc };
}

const atm30 = {
  id: 'atm-gold',
  name: 'ATM GOLD',
  yesoneSku: 'ATM30GAY',
  modelid: 'ATM30',
};

const PAS_LIST = ['YJ010085', 'YJ011228', 'YJ011440', 'YJ011775', 'YJ011778'];

function request(uid, data) {
  return { auth: { uid }, data };
}

test('allotPasSerials Direct writes ATM30 list and rejects G/X', async () => {
  const db = createMemoryDb({
    'users/meezan': { role: 'rc_admin' },
    'users/rasheed': { role: 'verifier', rcId: 'meezan' },
  });
  const result = await allotPasSerialsHandler(
    request('meezan', {
      verifierUid: 'rasheed',
      serials: PAS_LIST,
      product: atm30,
      invoiceNo: 'YES/26-27/21940',
      source: 'interweighingDirect',
    }),
    db,
  );
  assert.equal(result.qty, 5);
  assert.equal(db._store['pasSerialBank/YJ010085'].pool, 'pas');
  assert.equal(db._store['pasSerialBank/YJ010085'].modelid, 'ATM30');
  assert.equal(db._store['pasSerialBank/YJ010085'].yesoneSku, 'ATM30GAY');
  assert.equal(db._store['pasSerialBank/YJ010085'].allottedToUid, 'rasheed');
  assert.equal(db._store['pasSerialBank/YJ011778'].status, 'allotted');
  assert.equal(db._store['pasSerialBank/X00110'], undefined);

  await assert.rejects(
    () =>
      allotPasSerialsHandler(
        request('meezan', {
          verifierUid: 'rasheed',
          serials: ['X00110'],
          product: atm30,
          source: 'interweighingDirect',
        }),
        db,
      ),
    /GAS X\/G/,
  );
});

test('allotPasSerials RC requires existing unused PAS bank seat', async () => {
  const db = createMemoryDb({
    'users/meezan': { role: 'rc_admin' },
    'users/rasheed': { role: 'verifier', rcId: 'meezan' },
  });
  await assert.rejects(
    () =>
      allotPasSerialsHandler(
        request('meezan', {
          verifierUid: 'rasheed',
          serials: ['YJ010085'],
          product: atm30,
          source: 'rcQuota',
        }),
        db,
      ),
    /unused PAS/,
  );

  db._store['pasSerialBank/YJ010085'] = {
    serialNumber: 'YJ010085',
    yesoneSku: 'ATM30GAY',
    productId: 'atm-gold',
    status: 'available',
  };
  const ok = await allotPasSerialsHandler(
    request('meezan', {
      verifierUid: 'rasheed',
      serials: ['YJ010085'],
      product: atm30,
      source: 'rcQuota',
    }),
    db,
  );
  assert.equal(ok.qty, 1);
  assert.equal(db._store['pasSerialBank/YJ010085'].allottedToUid, 'rasheed');
});

test('allotPasSerials does not fail-open onto another PAS product', async () => {
  assert.equal(
    pasMatchesProduct({ yesoneSku: 'KS10BAY' }, { id: 'atm-gold', yesoneSku: 'ATM30GAY', modelid: 'ATM30' }),
    false,
  );
  assert.equal(isGasStickerSerial('X00110'), true);
  const db = createMemoryDb({
    'users/meezan': { role: 'rc_admin' },
    'users/rasheed': { role: 'verifier', rcId: 'meezan' },
    'pasSerialBank/YJ010085': {
      serialNumber: 'YJ010085',
      yesoneSku: 'KS10BAY',
      status: 'available',
    },
  });
  await assert.rejects(
    () =>
      allotPasSerialsHandler(
        request('meezan', {
          verifierUid: 'rasheed',
          serials: ['YJ010085'],
          product: atm30,
          source: 'rcQuota',
        }),
        db,
      ),
    /not allotted to this PAS product/,
  );
});
