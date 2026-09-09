import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickQuotaSerialsForActor } from './rcQuotaMath.ts';
import { gasAllottedChoices } from './serialEntryPool.ts';
import {
  INTERWEIGHING_DIRECT_SOURCE,
  computeInterweighingDirectSeats,
  expandDirectSerialInput,
  isInterweighingDirectRecord,
  nextInterweighingDirectSerials,
  uniqueDirectSerials,
  yesoneOvRecordsForQuota,
} from './interweighingDirectSerials.ts';
import type { Product, SiteCalibration } from '../types.ts';

function ovRecord(
  serial: string,
  extra?: Partial<SiteCalibration>,
): SiteCalibration {
  return {
    id: serial || 'empty',
    rcId: 'meezan',
    verificationType: 'OV',
    customerId: 'c1',
    customerName: 'Shop',
    productId: 'bench-pc',
    productName: 'Bench PC',
    serialNumber: serial,
    ambientTemperature: '25',
    relativeHumidity: '60',
    sealIdentificationNumber: 'SEAL',
    createdAt: '2026-01-15T00:00:00.000Z',
    ...extra,
  };
}

const rasheedUnused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
const rasheedUsed = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);

describe('interweighing direct bank isolation', () => {
  it('expands a typed range without touching Yesone leftovers', () => {
    assert.deepEqual(expandDirectSerialInput({ serialStart: 'IW00001', serialEnd: 'IW00003' }), [
      'IW00001',
      'IW00002',
      'IW00003',
    ]);
    assert.deepEqual(
      expandDirectSerialInput({ serialStart: '', serialEnd: '', listText: 'IW00010, IW00011' }),
      ['IW00010', 'IW00011'],
    );
    assert.equal(uniqueDirectSerials(['IW00001', 'iw00001', 'X00423']).includes('X00423'), true);
    assert.deepEqual(nextInterweighingDirectSerials(['IW00001'], ['IW00002']), ['IW00001', 'IW00002']);
  });

  it('direct unused does not change Yesone used 20 / balance 130', () => {
    const yesoneUsed = rasheedUsed.map(serial => ovRecord(serial));
    const directJobs = [
      ovRecord('IW00001', { serialSource: INTERWEIGHING_DIRECT_SOURCE }),
      ovRecord('IW00002', { serialSource: INTERWEIGHING_DIRECT_SOURCE }),
    ];
    const mixed = [...yesoneUsed, ...directJobs];
    assert.equal(yesoneUsed.length, 20);
    assert.equal(yesoneOvRecordsForQuota(mixed).length, 20);
    assert.equal(mixed.length, 22);
    assert.equal(isInterweighingDirectRecord(directJobs[0]), true);
  });

  it('verifier RC GAS picker stays allotted-to-uid only (X00110–X00239)', () => {
    const mine = rasheedUnused;
    const remaining = pickQuotaSerialsForActor(
      {
        remaining: [...mine, 'X00423'],
        vctRemaining: ['X00423'],
        reservedSerials: mine,
        reservedForUids: ['rasheed'],
        reservedByUid: { rasheed: mine },
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    const bench: Product = {
      id: 'bench-pc',
      name: 'Bench PC',
      modelid: 'bench-pc',
      modelNo: 'B1',
      yesoneSku: 'GS50BAY',
      pasPreAllotted: false,
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
    };
    const choices = gasAllottedChoices({
      remaining,
      allotments: mine.map(serialNumber => ({ serialNumber, pool: 'gas' })),
      product: bench,
    });
    assert.equal(choices.length, 130);
    assert.equal(choices[0], 'X00110');
    assert.equal(choices[choices.length - 1], 'X00239');
    assert.equal(choices.includes('X00423'), false);
    assert.equal(choices.includes('IW00001'), false);
  });

  it('direct serials are a separate unused list', () => {
    const seats = computeInterweighingDirectSeats({
      allotted: ['IW00001', 'IW00002', 'IW00003'],
      records: [ovRecord('IW00001', { serialSource: INTERWEIGHING_DIRECT_SOURCE })],
    });
    assert.deepEqual(seats.unused, ['IW00002', 'IW00003']);
    assert.equal(seats.allottedQty, 3);
    assert.equal(seats.usedQty, 1);
    assert.equal(seats.balanceQty, 2);
    const yesonePick = pickQuotaSerialsForActor(
      {
        remaining: rasheedUnused,
        vctRemaining: rasheedUnused,
        reservedSerials: rasheedUnused,
        reservedForUids: ['rasheed'],
        reservedByUid: { rasheed: rasheedUnused },
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    assert.equal(yesonePick.includes('IW00002'), false);
  });
});
