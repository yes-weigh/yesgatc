import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  excludePasQuotaSerials,
  recordUsesPasQuota,
  resolveRcQuotaUsedQty,
} from './rcQuotaMath.ts';
import { validateOvQuotaDevices, validateOvQuotaSetup } from './ovQuotaGate.ts';

describe('resolveRcQuotaUsedQty', () => {
  it('uses live OV count when records are RC-wide', () => {
    assert.equal(
      resolveRcQuotaUsedQty({
        recordUsedCount: 587,
        storedUsed: 744,
        recordsAreRcWide: true,
        allottedQty: 744,
        remainingCount: 157,
      }),
      587,
    );
  });

  it('does not let stale YesOne used wipe remaining seats', () => {
    assert.equal(
      resolveRcQuotaUsedQty({
        recordUsedCount: 100,
        storedUsed: 744,
        recordsAreRcWide: false,
        allottedQty: 744,
        remainingCount: 157,
      }),
      587,
    );
  });

  it('lifts incomplete VCT count when YesOne used is below remaining seats', () => {
    assert.equal(
      resolveRcQuotaUsedQty({
        recordUsedCount: 20,
        storedUsed: 400,
        recordsAreRcWide: false,
        allottedQty: 744,
        remainingCount: 157,
      }),
      400,
    );
  });
});

describe('PAS exclusion', () => {
  it('drops PAS serials from GAS lists', () => {
    assert.deepEqual(
      excludePasQuotaSerials(['G0001', 'YJ01001', 'G0002'], ['YJ01001']),
      ['G0001', 'G0002'],
    );
  });

  it('treats PAS product OVs as non-quota', () => {
    assert.equal(recordUsesPasQuota('atm', ['atm']), true);
    assert.equal(recordUsesPasQuota('mzn', ['atm']), false);
    assert.equal(recordUsesPasQuota('', ['atm']), false);
  });
});

describe('OV gate PAS vs GAS', () => {
  const emptyGate = { remaining: [] as string[], balanceQty: 0, heldSerials: [] as string[] };

  it('allows new OV when GAS balance is 0 if PAS products exist', () => {
    assert.equal(validateOvQuotaSetup('OV', emptyGate, true, true), null);
    assert.equal(
      validateOvQuotaSetup('OV', emptyGate, true, false),
      'OV quota balance is 0. Cannot start Original Verification.',
    );
  });

  it('does not charge PAS devices against GAS qty', () => {
    assert.equal(
      validateOvQuotaDevices('OV', [{ serial: 'YJ01001', pas: true }], emptyGate),
      null,
    );
    assert.equal(
      validateOvQuotaDevices(
        'OV',
        [{ serial: 'G0001', pas: false }],
        { remaining: ['G0001'], balanceQty: 0, heldSerials: [] },
      ),
      'OV quota balance is 0. Cannot start more GAS Original Verifications.',
    );
  });
});
