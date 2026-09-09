import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Product } from '../types';
import { pickQuotaSerialsForActor } from './rcQuotaMath.ts';
import { assignUnownedReservedToSoleUid } from './vrAllotted.ts';
import {
  applyOcrSerialToPool,
  filterGasAllottedChoices,
  gasAllottedChoices,
  gasAllottedEmptyLabel,
  gasAllottedEmptyProductHint,
  serialEntryMode,
  showsGasAllottedSerialGrid,
  validateSerialForProductPool,
} from './serialEntryPool.ts';

function product(partial: Pick<Product, 'id'> & Partial<Product>): Product {
  return {
    name: partial.name || partial.id,
    modelNo: partial.modelNo || '',
    typeOfInstrument: '',
    manufacturerBrandSeries: '',
    accuracyClass: '',
    maximumCapacity: 0,
    minimumCapacity: 0,
    verificationScaleInterval: 0,
    unitOfMeasurement: 'kg',
    actualScaleInterval: 0,
    noOfVerificationIntervals: 0,
    maximumPermissibleError: 0,
    supplyVoltage: '',
    modelApprovalNo: '',
    modelid: partial.modelid || '',
    pasPreAllotted: false,
    ...partial,
  };
}

const gasScale = product({
  id: 'gas-10',
  name: 'GAS 10 kg',
  yesoneSku: 'GS10BAY',
  modelNo: 'G10',
  pasPreAllotted: false,
});

const pasScale = product({
  id: 'pas-10',
  name: 'PAS 10 kg',
  yesoneSku: 'KS10BAY',
  modelNo: 'YSK10',
  pasPreAllotted: true,
});

const allotments = [
  { serialNumber: 'G0001', productId: 'gas-10', sku: 'GS10BAY', modelNo: 'G10', pool: 'gas' },
  { serialNumber: 'G0002', productId: 'gas-10', sku: 'GS10BAY', pool: 'gas' },
  { serialNumber: 'G0099', productId: 'gas-60', sku: 'GS60BAY', pool: 'gas' },
  { serialNumber: 'YJ00001', productId: 'pas-10', sku: 'KS10BAY', pool: 'pas' },
];

describe('serialEntryMode', () => {
  it('selects GAS list vs PAS type from pasPreAllotted', () => {
    assert.equal(serialEntryMode(gasScale), 'gas-select');
    assert.equal(serialEntryMode(pasScale), 'pas-type');
    assert.equal(serialEntryMode(null), 'gas-select');
  });
});

describe('showsGasAllottedSerialGrid', () => {
  it('PAS hides the allotted sticker grid', () => {
    assert.equal(showsGasAllottedSerialGrid(pasScale, 'OV'), false);
    assert.equal(showsGasAllottedSerialGrid(pasScale, 'RV'), false);
  });

  it('GAS OV still lists allotted seats', () => {
    assert.equal(showsGasAllottedSerialGrid(gasScale, 'OV'), true);
  });

  it('GAS RV types existing serial — no unused-seat grid', () => {
    assert.equal(showsGasAllottedSerialGrid(gasScale, 'RV'), false);
  });

  it('missing product does not dump remaining seats', () => {
    assert.equal(showsGasAllottedSerialGrid(null, 'OV'), false);
  });
});

function xSerials(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `X${String(from + i).padStart(5, '0')}`);
}

describe('gasAllottedChoices', () => {
  it('lists unused GAS seats for every GAS product, never PAS', () => {
    assert.deepEqual(
      gasAllottedChoices({
        remaining: ['G0001', 'G0002', 'G0099', 'YJ00001'],
        allotments,
        product: gasScale,
      }),
      ['G0001', 'G0002', 'G0099'],
    );
  });

  it('does not use PAS bank / PAS-pool rows for GAS', () => {
    const choices = gasAllottedChoices({
      remaining: ['G0001', 'YJ00001'],
      allotments,
      product: gasScale,
    });
    assert.deepEqual(choices, ['G0001']);
    assert.equal(choices.includes('YJ00001'), false);
  });

  it('does not add a typed current serial that is not allotted', () => {
    assert.deepEqual(
      gasAllottedChoices({
        remaining: ['G0001'],
        allotments,
        product: gasScale,
      }),
      ['G0001'],
    );
  });

  it('different GAS SKU still lists the unused GAS bank', () => {
    const other = product({ id: 'gas-other', name: 'Other', yesoneSku: 'OTHER', pasPreAllotted: false });
    assert.deepEqual(
      gasAllottedChoices({
        remaining: ['G0001', 'G0002'],
        allotments,
        product: other,
      }),
      ['G0001', 'G0002'],
    );
  });

  it('keeps unused GAS when allotment only has a Yesone name', () => {
    const bench = product({ id: 'bench-pc', name: 'Bench PC', yesoneSku: 'GS50BAY', pasPreAllotted: false });
    assert.deepEqual(
      gasAllottedChoices({
        remaining: ['X00423', 'X00301', 'YJ00245'],
        allotments: [
          { serialNumber: 'X00423', productId: 'bench-pc', sku: 'GS50BAY', pool: 'gas' },
          { serialNumber: 'X00301', productName: 'ELECTRONIC WEIGHING SCALE', pool: 'gas' },
          { serialNumber: 'YJ00245', productId: 'pas-10', sku: 'KS10BAY', pool: 'pas' },
        ],
        product: bench,
      }),
      ['X00301', 'X00423'],
    );
  });

  it('Yesone SKU/model on allotment rows does not hide other GAS unused', () => {
    const bench = product({
      id: 'bench-pc',
      name: 'Bench PC',
      yesoneSku: 'GS50BAY',
      modelNo: 'PC50',
      pasPreAllotted: false,
    });
    assert.deepEqual(
      gasAllottedChoices({
        remaining: ['X00346', 'X00999'],
        allotments: [
          { serialNumber: 'X00346', sku: 'GS50BAY-50', productName: 'BENCH PC 50KG 5G', pool: 'gas' },
          { serialNumber: 'X00999', productId: 'other-id', sku: 'GS100BAY', modelNo: 'PC100', pool: 'gas' },
        ],
        product: bench,
      }),
      ['X00346', 'X00999'],
    );
  });

  it('VCT sees parent unused; verifier sees only own allotted unused', () => {
    const bench = product({
      id: 'bench-pc',
      name: 'Bench PC',
      yesoneSku: 'GS50BAY',
      pasPreAllotted: false,
    });
    const allotments = [
      { serialNumber: 'X00423', productId: 'bench-pc', sku: 'GS50BAY', pool: 'gas' },
      { serialNumber: 'X00301', productName: 'ELECTRONIC WEIGHING SCALE', pool: 'gas' },
      { serialNumber: 'G0541', sku: 'GS50BAY-50', productName: 'BENCH PC 50KG 5G', pool: 'gas' },
      { serialNumber: 'YJ00245', productId: 'pas-10', sku: 'KS10BAY', pool: 'pas' },
      { serialNumber: 'X00999', productId: 'other-id', sku: 'GS100BAY', pool: 'gas' },
    ];
    const seats = {
      remaining: ['X00423', 'X00301', 'G0541', 'YJ00245', 'X00999'],
      vctRemaining: ['X00423', 'G0541'],
      reservedSerials: ['X00301'],
      reservedForUids: ['other-verifier'],
      reservedByUid: { 'other-verifier': ['X00301'] },
    };
    const rcRemaining = pickQuotaSerialsForActor(seats, { isRcAdmin: true, actorUid: 'meezan' });
    const vctRemaining = pickQuotaSerialsForActor(seats, { isVct: true, actorUid: 'hafiz' });
    const rasheedRemaining = pickQuotaSerialsForActor(seats, {
      isVerifier: true,
      actorUid: 'rasheed',
    });
    const otherRemaining = pickQuotaSerialsForActor(seats, {
      isVerifier: true,
      actorUid: 'other-verifier',
    });
    const rcChoices = gasAllottedChoices({ remaining: rcRemaining, allotments, product: bench });
    const vctChoices = gasAllottedChoices({ remaining: vctRemaining, allotments, product: bench });
    const rasheedChoices = gasAllottedChoices({
      remaining: rasheedRemaining,
      allotments,
      product: bench,
    });
    const otherChoices = gasAllottedChoices({
      remaining: otherRemaining,
      allotments,
      product: bench,
    });
    assert.deepEqual(rcChoices, ['G0541', 'X00301', 'X00423', 'X00999']);
    assert.deepEqual(vctChoices, ['G0541', 'X00423']);
    assert.deepEqual(rasheedChoices, []);
    assert.deepEqual(otherChoices, ['X00301']);
  });

  it('verifier chips are own reserved unused only — not RC leftover, not other uid', () => {
    const bench = product({
      id: 'bench-pc',
      name: 'Bench PC',
      yesoneSku: 'GS50BAY',
      pasPreAllotted: false,
    });
    const allotments = [
      { serialNumber: 'X00423', productId: 'bench-pc', sku: 'GS50BAY', pool: 'gas' },
      { serialNumber: 'X00424', productId: 'bench-pc', sku: 'GS50BAY', pool: 'gas' },
      { serialNumber: 'X00472', productId: 'bench-pc', sku: 'GS50BAY', pool: 'gas' },
    ];
    const remaining = pickQuotaSerialsForActor(
      {
        remaining: ['X00423', 'X00424', 'X00472'],
        vctRemaining: ['X00423', 'X00424'],
        reservedSerials: ['X00423', 'X00472'],
        reservedForUids: ['rasheed', 'other-verifier'],
        reservedByUid: { rasheed: ['X00423'], 'other-verifier': ['X00472'] },
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    assert.deepEqual(
      gasAllottedChoices({ remaining, allotments, product: bench }),
      ['X00423'],
    );
  });

  it('reserved empty + remaining unused → verifier GAS chips empty', () => {
    const bench = product({
      id: 'bench-pc',
      name: 'Bench PC',
      yesoneSku: 'GS50BAY',
      pasPreAllotted: false,
    });
    const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const allotments = unused.map(serialNumber => ({
      serialNumber,
      productId: 'bench-pc',
      sku: 'GS50BAY',
      pool: 'gas',
    }));
    const remaining = pickQuotaSerialsForActor(
      {
        remaining: unused,
        vctRemaining: unused,
        reservedSerials: [] as string[],
        reservedForUids: [] as string[],
        reservedByUid: {} as Record<string, string[]>,
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    assert.deepEqual(gasAllottedChoices({ remaining, allotments, product: bench }), []);
  });

  it('Yesone productId-only allotment row still lists Bench PC unused for this verifier', () => {
    const bench = product({
      id: 'bench-pc',
      name: 'Bench PC',
      yesoneSku: 'GS50BAY',
      pasPreAllotted: false,
    });
    const mine = ['X00110', 'X00111'];
    assert.deepEqual(
      gasAllottedChoices({
        remaining: mine,
        allotments: mine.map(serialNumber => ({
          serialNumber,
          productId: 'yesone-native-id',
          pool: 'gas',
        })),
        product: bench,
      }),
      mine,
    );
  });

  it('sole-verifier unowned reserved unused becomes chips; RC leftover remaining does not', () => {
    const bench = product({
      id: 'bench-pc',
      name: 'Bench PC',
      yesoneSku: 'GS50BAY',
      pasPreAllotted: false,
    });
    const used = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);
    const unused = Array.from({ length: 11 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const leftover = ['X00423', 'X00424', 'X00472', 'X00473'];
    const reservedByUid = assignUnownedReservedToSoleUid({
      allottedByUid: { rasheed: used },
      unownedReserved: unused,
      reservedForUids: ['rasheed'],
    });
    const remaining = pickQuotaSerialsForActor(
      {
        remaining: [...leftover, ...unused],
        vctRemaining: leftover,
        reservedSerials: unused,
        reservedForUids: ['rasheed'],
        reservedByUid,
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    const allotments = [...leftover, ...unused].map(serialNumber => ({
      serialNumber,
      productId: 'bench-pc',
      sku: 'GS50BAY',
      pool: 'gas',
    }));
    assert.deepEqual(gasAllottedChoices({ remaining, allotments, product: bench }), unused);
    assert.equal(remaining.includes('X00423'), false);
  });

  it('Rasheed reserved unused X00110–X00120 → those chips only', () => {
    const bench = product({
      id: 'bench-pc',
      name: 'Bench PC',
      yesoneSku: 'GS50BAY',
      pasPreAllotted: false,
    });
    const mine = Array.from({ length: 11 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const leftover = ['X00423', 'X00424', 'X00472', 'X00473'];
    const remaining = pickQuotaSerialsForActor(
      {
        remaining: [...leftover, ...mine],
        vctRemaining: leftover,
        reservedSerials: mine,
        reservedForUids: ['rasheed'],
        reservedByUid: { rasheed: mine },
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    const allotments = [...leftover, ...mine].map(serialNumber => ({
      serialNumber,
      productId: 'bench-pc',
      sku: 'GS50BAY',
      pool: 'gas',
    }));
    assert.deepEqual(gasAllottedChoices({ remaining, allotments, product: bench }), mine);
  });

  it('sole verifier unused X00110–X00239 lists for every GAS SKU; used and leftover stay out', () => {
    const unused = xSerials(110, 130);
    const used = xSerials(90, 20);
    const leftover = ['X00423'];
    const productA = product({
      id: 'bench-pc',
      name: 'Bench PC 50kg 5g',
      yesoneSku: 'GS50BAY',
      modelNo: 'PC50',
      pasPreAllotted: false,
    });
    const productB = product({
      id: 'gas-100',
      name: 'GAS 100 kg',
      yesoneSku: 'GS100BAY',
      modelNo: 'PC100',
      pasPreAllotted: false,
    });
    const reservedByUid = assignUnownedReservedToSoleUid({
      allottedByUid: { rasheed: [...used, ...unused] },
      unownedReserved: [],
      reservedForUids: ['rasheed'],
      rosterUids: ['rasheed'],
    });
    const remaining = pickQuotaSerialsForActor(
      {
        remaining: [...leftover, ...unused],
        vctRemaining: leftover,
        reservedSerials: unused,
        reservedForUids: ['rasheed'],
        reservedByUid,
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    const allotments = [
      ...unused.map(serialNumber => ({
        serialNumber,
        productId: 'yesone-native-id',
        sku: 'GS50BAY',
        modelNo: 'PC50',
        productName: 'BENCH PC 50KG 5G',
        pool: 'gas',
      })),
      ...used.map(serialNumber => ({
        serialNumber,
        productId: 'yesone-native-id',
        sku: 'GS50BAY',
        pool: 'gas',
      })),
      { serialNumber: 'X00423', productId: 'bench-pc', sku: 'GS50BAY', pool: 'gas' },
      { serialNumber: 'YJ00245', productId: 'pas-10', sku: 'KS10BAY', pool: 'pas' },
    ];
    const forA = gasAllottedChoices({ remaining, allotments, product: productA });
    const forB = gasAllottedChoices({ remaining, allotments, product: productB });
    assert.equal(remaining.length, 130);
    assert.deepEqual(forA, unused);
    assert.deepEqual(forB, unused);
    assert.equal(forA.includes('X00090'), false);
    assert.equal(forA.includes('X00109'), false);
    assert.equal(forA.includes('X00423'), false);
    assert.equal(forA.includes('YJ00245'), false);
    assert.equal(
      remaining.length === 0 ? gasAllottedEmptyProductHint(true) : null,
      null,
    );
  });

  it('empty copy is only for empty unused allotted remaining', () => {
    assert.equal(gasAllottedEmptyLabel(true), 'None allotted to you');
    assert.equal(gasAllottedEmptyProductHint(true), 'No serials allotted to you for this product.');
    assert.deepEqual(
      gasAllottedChoices({
        remaining: [],
        allotments: [{ serialNumber: 'X00110', sku: 'GS50BAY', pool: 'gas' }],
        product: product({ id: 'bench-pc', name: 'Bench PC', yesoneSku: 'GS50BAY' }),
      }),
      [],
    );
  });

  it('does not cap the unused GAS list', () => {
    const many = Array.from({ length: 80 }, (_, i) => `X${String(i + 1).padStart(5, '0')}`);
    const rows = many.map(serialNumber => ({
      serialNumber,
      productId: 'gas-10',
      sku: 'GS10BAY',
      pool: 'gas',
    }));
    const choices = gasAllottedChoices({
      remaining: many,
      allotments: rows,
      product: gasScale,
    });
    assert.equal(choices.length, 80);
    assert.equal(choices[0], 'X00001');
    assert.equal(choices[79], 'X00080');
  });
});

describe('filterGasAllottedChoices', () => {
  const seats = ['X00423', 'X00424', 'X00472', 'G0541'];

  it('filters by a fragment and keeps the full unused set when empty', () => {
    assert.deepEqual(filterGasAllottedChoices(seats, ''), seats);
    assert.deepEqual(filterGasAllottedChoices(seats, 'x004'), ['X00423', 'X00424', 'X00472']);
    assert.deepEqual(filterGasAllottedChoices(seats, '423'), ['X00423']);
    assert.deepEqual(filterGasAllottedChoices(seats, 'G054'), ['G0541']);
  });
});

describe('validateSerialForProductPool', () => {
  const gasChoices = ['G0001', 'G0002'];

  it('GAS OV must pick an allotted unused seat', () => {
    assert.equal(
      validateSerialForProductPool({
        mode: 'gas-select',
        verificationType: 'OV',
        serial: 'G0001',
        gasChoices,
      }),
      null,
    );
    assert.equal(
      validateSerialForProductPool({
        mode: 'gas-select',
        verificationType: 'OV',
        serial: 'INVENTED',
        gasChoices,
      }),
      'Serial INVENTED is not in the allotted list for this product.',
    );
  });

  it('rejects invented serials even when parent RC has unused seats', () => {
    assert.equal(
      validateSerialForProductPool({
        mode: 'gas-select',
        verificationType: 'OV',
        serial: 'INVENTED',
        gasChoices: ['X00423', 'G0541'],
      }),
      'Serial INVENTED is not in the allotted list for this product.',
    );
  });

  it('GAS OV empty list cannot invent a serial', () => {
    assert.equal(
      validateSerialForProductPool({
        mode: 'gas-select',
        verificationType: 'OV',
        serial: 'G0001',
        gasChoices: [],
      }),
      'No unused allotted serials for this product.',
    );
  });

  it('verifier empty list is allotted-to-you, not RC pool empty', () => {
    assert.equal(
      validateSerialForProductPool({
        mode: 'gas-select',
        verificationType: 'OV',
        serial: 'X00423',
        gasChoices: [],
        scopedToVerifier: true,
      }),
      'No serials allotted to you for this product.',
    );
  });

  it('PAS accepts typed serial here; bank check is async', () => {
    assert.equal(
      validateSerialForProductPool({
        mode: 'pas-type',
        verificationType: 'OV',
        serial: 'YJ00001',
        gasChoices,
      }),
      null,
    );
    assert.equal(
      validateSerialForProductPool({
        mode: 'pas-type',
        verificationType: 'OV',
        serial: 'NOT-IN-GAS-LIST',
        gasChoices,
      }),
      null,
    );
  });

  it('RV GAS types existing serial — not unused-seat select', () => {
    assert.equal(
      validateSerialForProductPool({
        mode: 'gas-select',
        verificationType: 'RV',
        serial: 'OLD-USED-SERIAL',
        gasChoices,
      }),
      null,
    );
  });
});

describe('applyOcrSerialToPool', () => {
  it('GAS OCR only fills a listed allotted seat', () => {
    assert.equal(
      applyOcrSerialToPool({
        mode: 'gas-select',
        ocrSerial: 'G0002',
        allottedMatch: 'G0002',
        gasChoices: ['G0001', 'G0002'],
      }),
      'G0002',
    );
    assert.equal(
      applyOcrSerialToPool({
        mode: 'gas-select',
        ocrSerial: 'FAKE99',
        allottedMatch: null,
        gasChoices: ['G0001', 'G0002'],
      }),
      null,
    );
  });

  it('PAS OCR fills typed serial without using GAS list', () => {
    assert.equal(
      applyOcrSerialToPool({
        mode: 'pas-type',
        ocrSerial: 'YJ00001',
        allottedMatch: 'G0001',
        gasChoices: ['G0001'],
      }),
      'YJ00001',
    );
  });
});
