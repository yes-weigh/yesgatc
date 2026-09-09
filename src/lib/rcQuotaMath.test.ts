import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countReservedOverlaySeats,
  excludePasQuotaSerials,
  pickQuotaSerialsForActor,
  recordUsesPasQuota,
  resolveRcQuotaUsedQty,
} from './rcQuotaMath.ts';
import { mergePasBlockedSerials, pasSerialsFromMetaRanges } from './pasSerialBankMatch.ts';
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

  it('drops PAS meta-range serials that leaked into RC remaining', () => {
    const blocked = mergePasBlockedSerials(
      ['YJ00245'],
      pasSerialsFromMetaRanges([{ from: 'YJ01164', to: 'YJ01164' }]),
    );
    assert.deepEqual(
      excludePasQuotaSerials(['X00168', 'YJ00245', 'YJ01164', 'X00301'], blocked),
      ['X00168', 'X00301'],
    );
  });

  it('never drops GAS X/G because a YJ PAS range exists', () => {
    const blocked = mergePasBlockedSerials(
      ['X00423', 'G0541'],
      pasSerialsFromMetaRanges([{ from: 'YJ00245', to: 'YJ00245' }]),
    );
    assert.deepEqual(
      excludePasQuotaSerials(['X00423', 'G0541', 'YJ00245', 'Y10315'], blocked),
      ['X00423', 'G0541', 'Y10315'],
    );
  });

  it('treats PAS product OVs as non-quota', () => {
    assert.equal(recordUsesPasQuota('atm', ['atm']), true);
    assert.equal(recordUsesPasQuota('mzn', ['atm']), false);
    assert.equal(recordUsesPasQuota('', ['atm']), false);
  });
});

describe('countReservedOverlaySeats', () => {
  it('counts displayed reserved seats, not reserved-only leftovers', () => {
    assert.equal(
      countReservedOverlaySeats(
        ['X00423', 'X00301', 'G0541'],
        ['X00301', 'Y99999'],
      ),
      1,
    );
  });

  it('skips voided seats even if reserved', () => {
    assert.equal(
      countReservedOverlaySeats(
        ['X00423', 'X00301'],
        ['X00423', 'X00301'],
        ['X00301'],
      ),
      1,
    );
  });

  it('matches reserved flag case-insensitively', () => {
    assert.equal(
      countReservedOverlaySeats(['x00423', 'G0541'], ['X00423']),
      1,
    );
  });
});

describe('pickQuotaSerialsForActor', () => {
  const meezanUnused = {
    remaining: ['X00423', 'X00301', 'G0541'],
    vctRemaining: ['X00423', 'G0541'],
    reservedSerials: ['X00301'],
    reservedForUids: ['other-verifier'],
    reservedByUid: { 'other-verifier': ['X00301'] },
  };

  it('RC sees reserved seats; VCT does not', () => {
    const rc = pickQuotaSerialsForActor(meezanUnused, { isRcAdmin: true, actorUid: 'meezan' });
    const vct = pickQuotaSerialsForActor(meezanUnused, { isVct: true, actorUid: 'hafiz' });
    assert.deepEqual(rc, ['X00423', 'X00301', 'G0541']);
    assert.deepEqual(vct, ['X00423', 'G0541']);
  });

  it('verifier with no reserved-by-uid still sees parent unused', () => {
    const verifier = pickQuotaSerialsForActor(meezanUnused, {
      isVerifier: true,
      actorUid: 'rasheed',
    });
    assert.deepEqual(verifier, ['X00423', 'G0541']);
  });

  it('verifier sees parent unused plus their allotted', () => {
    const seats = {
      ...meezanUnused,
      reservedForUids: ['rasheed'],
      reservedByUid: { rasheed: ['X00301'] },
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      ['X00423', 'G0541', 'X00301'],
    );
  });

  it('empty reserved map does not wipe parent unused seats', () => {
    const seats = {
      remaining: ['X00423', 'G0541'],
      vctRemaining: ['X00423', 'G0541'],
      reservedSerials: [] as string[],
      reservedForUids: [] as string[],
      reservedByUid: {} as Record<string, string[]>,
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      ['X00423', 'G0541'],
    );
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
