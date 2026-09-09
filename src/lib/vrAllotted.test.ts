import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allottableVerifierSerials,
  mergeSerialLists,
  nextVerifierAllottedByUid,
  normalizeVerifierAllottedByUid,
  reservedSerialsAfterVerifierAllot,
  roleCanOpenVrAllotted,
  vrAllottedStatus,
} from './vrAllotted.ts';

describe('roleCanOpenVrAllotted', () => {
  it('hides without verifiers and from every non-RC role', () => {
    assert.equal(roleCanOpenVrAllotted('rc_admin', false), false);
    assert.equal(roleCanOpenVrAllotted('rc_admin', true), true);
    assert.equal(roleCanOpenVrAllotted('vct', true), false);
    assert.equal(roleCanOpenVrAllotted('verifier', true), false);
    assert.equal(roleCanOpenVrAllotted('super_admin', true), false);
    assert.equal(roleCanOpenVrAllotted(undefined, true), false);
  });
});

describe('vrAllottedStatus', () => {
  it('counts allotted / used / unused per verifier and totals', () => {
    const { rows, totals } = vrAllottedStatus({
      allottedByUid: {
        rasheed: ['X00423', 'X00301', 'G0541'],
        other: ['Y10315'],
      },
      usedSerials: ['X00423', 'Y10315'],
      voidedSerials: ['G0541'],
      verifierUids: ['rasheed', 'other'],
    });
    assert.deepEqual(
      rows.map(row => ({ uid: row.uid, allotted: row.allotted, used: row.used, unused: row.unused })),
      [
        { uid: 'rasheed', allotted: 3, used: 1, unused: 1 },
        { uid: 'other', allotted: 1, used: 1, unused: 0 },
      ],
    );
    assert.deepEqual(rows[0].unusedSerials, ['X00301']);
    assert.deepEqual(rows[0].usedSerials, ['X00423']);
    assert.deepEqual(totals, { allotted: 4, used: 2, unused: 1 });
  });

  it('shows a created verifier with zero seats', () => {
    const { rows, totals } = vrAllottedStatus({
      allottedByUid: {},
      usedSerials: ['X00423'],
      verifierUids: ['rasheed'],
    });
    assert.deepEqual(rows[0], {
      uid: 'rasheed',
      allotted: 0,
      used: 0,
      unused: 0,
      unusedSerials: [],
      usedSerials: [],
    });
    assert.deepEqual(totals, { allotted: 0, used: 0, unused: 0 });
  });
});

describe('nextVerifierAllottedByUid', () => {
  it('reassigns a seat from another verifier and keeps used seats', () => {
    const next = nextVerifierAllottedByUid({
      prev: {
        other: ['X00301', 'X00423'],
        rasheed: ['G0541', 'Y10315'],
      },
      verifierUid: 'rasheed',
      addSerials: ['X00301'],
      removeSerials: ['G0541'],
    });
    assert.deepEqual(next.rasheed, ['X00301', 'Y10315']);
    assert.deepEqual(next.other, ['X00423']);
  });

  it('remove all drops that verifier only, including used seats', () => {
    const prev = {
      rasheed: ['X00423', 'X00301', 'G0541'],
      other: ['Y10315'],
    };
    const next = nextVerifierAllottedByUid({
      prev,
      verifierUid: 'rasheed',
      addSerials: [],
      removeSerials: prev.rasheed,
    });
    assert.equal('rasheed' in next, false);
    assert.deepEqual(next.other, ['Y10315']);
    const { rows, totals } = vrAllottedStatus({
      allottedByUid: next,
      usedSerials: ['X00423', 'Y10315'],
      verifierUids: ['rasheed', 'other'],
    });
    assert.deepEqual(
      rows.map(row => ({ uid: row.uid, allotted: row.allotted, used: row.used, unused: row.unused })),
      [
        { uid: 'rasheed', allotted: 0, used: 0, unused: 0 },
        { uid: 'other', allotted: 1, used: 1, unused: 0 },
      ],
    );
    assert.deepEqual(totals, { allotted: 1, used: 1, unused: 0 });
  });
});

describe('allottableVerifierSerials', () => {
  it('does not invent serials and blocks other roster seats', () => {
    assert.deepEqual(
      allottableVerifierSerials({
        remaining: ['X00423', 'X00301', 'G0541'],
        allottedByUid: { other: ['X00301'], rasheed: ['G0541'] },
        verifierUid: 'rasheed',
        rosterUids: ['rasheed', 'other'],
      }),
      ['G0541', 'X00423'],
    );
  });

  it('lets RC steal seats left on a deleted verifier uid', () => {
    assert.deepEqual(
      allottableVerifierSerials({
        remaining: ['X00301', 'X00423'],
        allottedByUid: { gone: ['X00301'] },
        verifierUid: 'rasheed',
        rosterUids: ['rasheed'],
      }),
      ['X00301', 'X00423'],
    );
  });
});

describe('reservedSerialsAfterVerifierAllot', () => {
  it('reserves newly allotted seats and returns unallotted seats to the public pool', () => {
    assert.deepEqual(
      reservedSerialsAfterVerifierAllot({
        reservedSerials: ['X00301', 'Z99999'],
        prevAllotted: { rasheed: ['X00301'] },
        nextAllotted: { rasheed: ['G0541'] },
      }),
      ['G0541', 'Z99999'],
    );
  });
});

describe('normalizeVerifierAllottedByUid', () => {
  it('drops empty uids and non-serial junk', () => {
    assert.deepEqual(
      normalizeVerifierAllottedByUid({
        rasheed: ['X00423', '744', ''],
        '': ['G0541'],
      }),
      { rasheed: ['X00423'] },
    );
  });
});

describe('mergeSerialLists', () => {
  it('keeps base order and appends new seats', () => {
    assert.deepEqual(
      mergeSerialLists(['X00423', 'G0541'], ['G0541', 'X00301']),
      ['X00423', 'G0541', 'X00301'],
    );
  });
});
