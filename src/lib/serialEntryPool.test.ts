import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Product } from '../types';
import {
  applyOcrSerialToPool,
  gasAllottedChoices,
  serialEntryMode,
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
