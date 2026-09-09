import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Product } from '../types';
import { pickQuotaSerialsForActor } from './rcQuotaMath.ts';
import {
  applyOcrSerialToPool,
  filterGasAllottedChoices,
  gasAllottedChoices,
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

describe('gasAllottedChoices', () => {
  it('lists unused GAS seats for that product only', () => {
    assert.deepEqual(
      gasAllottedChoices({
        remaining: ['G0001', 'G0002', 'G0099', 'YJ00001'],
        allotments,
        product: gasScale,
      }),
      ['G0001', 'G0002'],
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

  it('empty product match → empty list, no invented seats', () => {
    const other = product({ id: 'gas-other', name: 'Other', yesoneSku: 'OTHER', pasPreAllotted: false });
    assert.deepEqual(
      gasAllottedChoices({
        remaining: ['G0001', 'G0002'],
        allotments,
        product: other,
      }),
      [],
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

  it('loosens Yesone name/sku tokens for the same product', () => {
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
      ['X00346'],
    );
  });

  it('VCT/verifier options match parent unused plus own allotted for Bench PC', () => {
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
    assert.deepEqual(rcChoices, ['G0541', 'X00301', 'X00423']);
    assert.deepEqual(vctChoices, ['G0541', 'X00423']);
    assert.deepEqual(rasheedChoices, vctChoices);
    assert.deepEqual(otherChoices, ['G0541', 'X00301', 'X00423']);
    assert.equal(rasheedChoices.length === 0, false);
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
