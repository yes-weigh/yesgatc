import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRcQuotaSeats } from './rcQuotaSeats.ts';
import { pickQuotaSerialsForActor } from './rcQuotaMath.ts';
import { INTERWEIGHING_DIRECT_SOURCE } from './interweighingDirectSerials.ts';
import {
  INVOICE_ALLOT_FROM_HINT,
  INVOICE_ALLOT_FROM_INTERWEIGHING,
  INVOICE_ALLOT_FROM_RC_QUOTA,
  INVOICE_ALLOT_RANGE_ERROR,
  reservedSerialsAfterInvoiceAllotFrom,
  validateInterweighingDirectAllotmentRange,
  validateInvoiceAllotmentRange,
  validateRcQuotaAllotmentRange,
} from './invoiceAllotmentSource.ts';
import type { SiteCalibration } from '../types.ts';

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

const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
const used = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);
const allotted = [...used, ...unused];

function quotaSeats(
  extra: Partial<Parameters<typeof computeRcQuotaSeats>[0]> = {},
) {
  return computeRcQuotaSeats({
    rcCode: 'TST',
    companyName: 'Test Centre',
    ovQuota: '150',
    ovQuotaUsed: 20,
    recordsAreRcWide: true,
    storedSerials: allotted,
    allotSerials: allotted,
    voidedSerials: [],
    records: used.map(serial => ovRecord(serial)),
    reservedSerials: [],
    reservedForUids: [],
    reservedByUid: {},
    ...extra,
  });
}

describe('invoice allotment source rules', () => {
  it('RC mode rejects a serial outside remaining unused seats', () => {
    const outside = validateRcQuotaAllotmentRange({
      serialStart: 'IW00001',
      serialEnd: 'IW00001',
      unusedRcSerials: unused,
    });
    assert.equal(outside.ok, false);
    assert.equal(outside.error, INVOICE_ALLOT_RANGE_ERROR.rcQuota);
    const gap = validateRcQuotaAllotmentRange({
      serialStart: 'X00110',
      serialEnd: 'X00112',
      unusedRcSerials: ['X00110', 'X00112'],
    });
    assert.equal(gap.ok, false);
    const inPool = validateRcQuotaAllotmentRange({
      serialStart: 'X00110',
      serialEnd: 'X00111',
      unusedRcSerials: unused,
    });
    assert.equal(inPool.ok, true);
    assert.equal(inPool.qty, 2);
  });

  it('direct mode accepts a serial not in RC remaining and does not decrement RC seats', () => {
    const before = quotaSeats();
    const direct = validateInterweighingDirectAllotmentRange({
      serialStart: 'IW00001',
      serialEnd: 'IW00003',
    });
    assert.equal(direct.ok, true);
    assert.deepEqual(direct.serials, ['IW00001', 'IW00002', 'IW00003']);
    assert.equal(
      validateRcQuotaAllotmentRange({
        serialStart: 'IW00001',
        serialEnd: 'IW00003',
        unusedRcSerials: unused,
      }).ok,
      false,
    );

    const reservedAfterDirect = reservedSerialsAfterInvoiceAllotFrom({
      allotFrom: INVOICE_ALLOT_FROM_INTERWEIGHING,
      reservedSerials: before.reservedSerials,
      serialStart: 'IW00001',
      serialEnd: 'IW00003',
    });
    assert.deepEqual(reservedAfterDirect, before.reservedSerials);

    const afterDirectJob = quotaSeats({
      records: [
        ...used.map(serial => ovRecord(serial)),
        ovRecord('IW00001', { serialSource: INTERWEIGHING_DIRECT_SOURCE }),
      ],
    });
    assert.equal(afterDirectJob.usedQty, before.usedQty);
    assert.equal(afterDirectJob.balanceQty, before.balanceQty);
    assert.equal(afterDirectJob.remaining.length, before.remaining.length);
    assert.equal(afterDirectJob.vctRemaining.length, before.vctRemaining.length);
    assert.equal(afterDirectJob.reservedSerials.length, before.reservedSerials.length);
  });

  it('Direct validator never consults the RC unused pool', () => {
    const result = validateInvoiceAllotmentRange({
      allotFrom: INVOICE_ALLOT_FROM_INTERWEIGHING,
      serialStart: 'IW00001',
      serialEnd: 'IW00001',
      unusedRcSerials: [],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.serials, ['IW00001']);
  });

  it('dispatcher switches rules with Allot from', () => {
    const rc = validateInvoiceAllotmentRange({
      allotFrom: INVOICE_ALLOT_FROM_RC_QUOTA,
      serialStart: 'IW00001',
      serialEnd: 'IW00001',
      unusedRcSerials: unused,
    });
    const direct = validateInvoiceAllotmentRange({
      allotFrom: INVOICE_ALLOT_FROM_INTERWEIGHING,
      serialStart: 'IW00001',
      serialEnd: 'IW00001',
      unusedRcSerials: unused,
    });
    assert.equal(rc.ok, false);
    assert.equal(rc.error, INVOICE_ALLOT_RANGE_ERROR.rcQuota);
    assert.equal(direct.ok, true);
    assert.equal(direct.error, null);
    assert.equal(INVOICE_ALLOT_FROM_HINT.rcQuota, 'Must be unused RC seats.');
    assert.equal(
      INVOICE_ALLOT_FROM_HINT.interweighingDirect,
      'Direct Interweighing — does not deduct RC quota.',
    );
  });

  it('RC mode overlays reserved seats; Direct leaves computeRcQuotaSeats reserved/vct unchanged', () => {
    const before = quotaSeats();
    const reservedAfterRc = reservedSerialsAfterInvoiceAllotFrom({
      allotFrom: INVOICE_ALLOT_FROM_RC_QUOTA,
      reservedSerials: before.reservedSerials,
      serialStart: 'X00110',
      serialEnd: 'X00111',
    });
    const afterRc = quotaSeats({
      reservedSerials: reservedAfterRc,
      reservedForUids: ['rasheed'],
      reservedByUid: { rasheed: reservedAfterRc },
    });
    assert.equal(afterRc.vctRemaining.length, before.vctRemaining.length - 2);
    assert.equal(afterRc.reservedSerials.length, 2);
    assert.equal(
      pickQuotaSerialsForActor(afterRc, { isVerifier: true, actorUid: 'rasheed' }).includes(
        'X00110',
      ),
      true,
    );

    const afterDirect = quotaSeats({
      records: [
        ...used.map(serial => ovRecord(serial)),
        ovRecord('IW00001', { serialSource: INTERWEIGHING_DIRECT_SOURCE }),
      ],
    });
    assert.deepEqual(afterDirect.vctRemaining, before.vctRemaining);
    assert.deepEqual(afterDirect.reservedSerials, before.reservedSerials);
    assert.equal(afterDirect.usedQty, before.usedQty);
    assert.equal(
      pickQuotaSerialsForActor(afterDirect, { isVerifier: true, actorUid: 'rasheed' }).includes(
        'IW00001',
      ),
      false,
    );
  });
});
