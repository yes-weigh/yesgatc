import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allottableVerifierSerials,
  assignUnownedReservedToSoleUid,
  mergeSerialLists,
  nextVerifierAllottedByUid,
  normalizeVerifierAllottedByUid,
  reservedSerialsAfterVerifierAllot,
  roleCanOpenVrAllotted,
  shouldShowVerificationStageQuotaTiles,
  unownedReservedSerials,
  vrAllottedEntryMatchesFilter,
  vrAllottedEntrySerials,
  vrAllottedRangeFullyInPool,
  vrAllottedRangeQty,
  vrAllottedRangeSerials,
  vrAllottedSeatList,
  verificationStageQuotaTotals,
  vrAllottedScopedView,
  vrAllottedStatus,
} from './vrAllotted.ts';

describe('shouldShowVerificationStageQuotaTiles', () => {
  it('Allotted / Used / Balance are verifier home only', () => {
    assert.equal(shouldShowVerificationStageQuotaTiles('verifier'), true);
    assert.equal(shouldShowVerificationStageQuotaTiles('rc_admin'), false);
    assert.equal(shouldShowVerificationStageQuotaTiles('vct'), false);
    assert.equal(shouldShowVerificationStageQuotaTiles('super_admin'), false);
    assert.equal(shouldShowVerificationStageQuotaTiles(undefined), false);
  });
});

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

  it('counts unused reserved seats as allotted unused, not used', () => {
    const { totals } = vrAllottedStatus({
      allottedByUid: {
        rasheed: ['X00423', 'X00301'],
      },
      usedSerials: ['X00423'],
      extraReservedSerials: ['G0541', 'Y10315', 'X00301'],
      verifierUids: ['rasheed'],
    });
    assert.deepEqual(totals, { allotted: 4, used: 1, unused: 3 });
  });

  it('used-only allotment plus extra reserved unused is 150/20/130', () => {
    const used = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);
    const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const { totals } = vrAllottedStatus({
      allottedByUid: { rasheed: used },
      usedSerials: used,
      extraReservedSerials: unused,
      verifierUids: ['rasheed'],
    });
    assert.deepEqual(totals, { allotted: 150, used: 20, unused: 130 });
  });
});

describe('vrAllottedSeatList', () => {
  it('lists verifier seats plus extra reserved, used vs unused, skips voided', () => {
    const seats = vrAllottedSeatList({
      allottedByUid: {
        rasheed: ['X00423', 'X00301', 'G0541'],
      },
      usedSerials: ['X00423'],
      voidedSerials: ['G0541'],
      extraReservedSerials: ['Y10315', 'X00301'],
    });
    assert.deepEqual(seats, [
      { serial: 'X00301', uid: 'rasheed', used: false },
      { serial: 'X00423', uid: 'rasheed', used: true },
      { serial: 'Y10315', uid: null, used: false },
    ]);
  });
});

describe('vrAllottedRangeQty', () => {
  it('counts inclusive Yesone from/to expansion', () => {
    assert.equal(vrAllottedRangeQty('G0001', 'G0003'), 3);
    assert.equal(vrAllottedRangeQty('X00001', 'X00003'), 3);
    assert.equal(vrAllottedRangeQty('Y10315', 'Y10315'), 1);
  });
});

describe('vrAllottedRangeFullyInPool', () => {
  it('rejects invented serials and gaps outside unused pool', () => {
    assert.equal(
      vrAllottedRangeFullyInPool('G0001', 'G0003', ['G0001', 'G0002', 'G0003', 'G0004']),
      true,
    );
    assert.equal(
      vrAllottedRangeFullyInPool('G0001', 'G0003', ['G0001', 'G0003']),
      false,
    );
    assert.equal(vrAllottedRangeFullyInPool('', 'G0003', ['G0001']), false);
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
  it('empty allotted map leaves remaining unused available', () => {
    const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    assert.deepEqual(
      allottableVerifierSerials({
        remaining: unused,
        allottedByUid: {},
        verifierUid: 'rasheed',
      }),
      unused,
    );
  });

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

describe('assignUnownedReservedToSoleUid', () => {
  it('attaches unused reserved greens to the sole verifier who already has used seats', () => {
    const used = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);
    const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const next = assignUnownedReservedToSoleUid({
      allottedByUid: { rasheed: used },
      unownedReserved: unused,
      reservedForUids: ['rasheed'],
    });
    assert.equal(next.rasheed?.length, 150);
    assert.equal(unused.every(serial => next.rasheed?.includes(serial)), true);
    assert.equal(next.rasheed?.includes('X00423'), false);
  });

  it('does not dump unowned reserved onto two verifiers', () => {
    const next = assignUnownedReservedToSoleUid({
      allottedByUid: { rasheed: ['X00090'], other: ['X00091'] },
      unownedReserved: ['X00110', 'X00423'],
      reservedForUids: ['rasheed', 'other'],
    });
    assert.deepEqual(next.rasheed, ['X00090']);
    assert.deepEqual(next.other, ['X00091']);
  });

  it('maps unowned reserved to sole reservedForUids when allotment map is empty', () => {
    const unused = ['X00110', 'X00111'];
    const next = assignUnownedReservedToSoleUid({
      allottedByUid: {},
      unownedReserved: unused,
      reservedForUids: ['rasheed'],
    });
    assert.deepEqual(next, { rasheed: unused });
  });

  it('leaves unowned reserved unassigned when no verifier uid exists', () => {
    assert.deepEqual(
      assignUnownedReservedToSoleUid({
        allottedByUid: {},
        unownedReserved: ['X00110'],
        reservedForUids: [],
      }),
      {},
    );
  });

  it('does not dump unowned reserved onto one of two roster verifiers', () => {
    const next = assignUnownedReservedToSoleUid({
      allottedByUid: { rasheed: ['X00090'] },
      unownedReserved: ['X00110'],
      rosterUids: ['rasheed', 'other'],
    });
    assert.deepEqual(next.rasheed, ['X00090']);
    assert.equal('other' in next, false);
  });
});

describe('vrAllottedScopedView', () => {
  const used = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);
  const remaining = Array.from({ length: 124 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
  const reservedUnused = Array.from({ length: 6 }, (_, i) => `X${String(234 + i).padStart(5, '0')}`);

  it('sole verifier remaining 124 + reserved unused 6 + used 20 → 150/20/130', () => {
    const { totals, seats } = vrAllottedScopedView({
      allottedByUid: { rasheed: [...used, ...remaining] },
      usedSerials: used,
      extraReservedSerials: reservedUnused,
      rosterUids: ['rasheed'],
    });
    assert.deepEqual(totals, { allotted: 150, used: 20, unused: 130 });
    assert.equal(seats.filter(seat => seat.used).length, 20);
    assert.equal(seats.filter(seat => !seat.used).length, 130);
    assert.equal(
      reservedUnused.every(serial =>
        seats.some(seat => seat.serial === serial && seat.uid === 'rasheed' && !seat.used),
      ),
      true,
    );
  });

  it('RASHEED filter keeps the same 150/20/130 tiles', () => {
    const { totals } = vrAllottedScopedView({
      allottedByUid: { rasheed: [...used, ...remaining] },
      usedSerials: used,
      reservedSerials: reservedUnused,
      rosterUids: ['rasheed'],
      verifierFilter: 'rasheed',
      statusFilter: 'all',
    });
    assert.deepEqual(totals, { allotted: 150, used: 20, unused: 130 });
  });

  it('two-verifier case does not steal the other uid reserved range', () => {
    const rasheed = vrAllottedScopedView({
      allottedByUid: { rasheed: ['X00090'], other: ['X00110', 'X00111'] },
      usedSerials: ['X00090'],
      extraReservedSerials: ['X00200'],
      rosterUids: ['rasheed', 'other'],
      verifierFilter: 'rasheed',
    });
    assert.deepEqual(
      rasheed.seats.map(seat => seat.serial),
      ['X00090'],
    );
    assert.deepEqual(rasheed.totals, { allotted: 1, used: 1, unused: 0 });
    const all = vrAllottedScopedView({
      allottedByUid: { rasheed: ['X00090'], other: ['X00110', 'X00111'] },
      usedSerials: ['X00090'],
      extraReservedSerials: ['X00200'],
      rosterUids: ['rasheed', 'other'],
      verifierFilter: 'all',
    });
    assert.equal(all.seats.some(seat => seat.serial === 'X00110' && seat.uid === 'other'), true);
    assert.equal(all.seats.some(seat => seat.serial === 'X00200' && seat.uid === null), true);
    assert.equal(all.seats.some(seat => seat.serial === 'X00111' && seat.uid === 'rasheed'), false);
  });

  it('unownedReservedSerials is reserved unused minus mapped uids', () => {
    assert.deepEqual(
      unownedReservedSerials(['X00090', 'X00200', 'X00200'], { rasheed: ['X00090'] }),
      ['X00200'],
    );
  });
});

describe('verificationStageQuotaTotals', () => {
  const used = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);
  const remaining = Array.from({ length: 124 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
  const reservedUnused = Array.from({ length: 6 }, (_, i) => `X${String(234 + i).padStart(5, '0')}`);
  const bank = {
    allottedByUid: { rasheed: [...used, ...remaining] },
    usedSerials: used,
    reservedSerials: reservedUnused,
    reservedForUids: ['rasheed'],
    rosterUids: ['rasheed'],
  };

  it('RC / sole verifier Meezan-Rasheed tiles are 150/20/130 not leftover 144', () => {
    const rc = verificationStageQuotaTotals({
      ...bank,
      actor: { isRcAdmin: true, actorUid: 'meezan' },
    });
    const rasheed = verificationStageQuotaTotals({
      ...bank,
      actor: { isVerifier: true, actorUid: 'rasheed' },
    });
    assert.deepEqual(rc, { allotted: 150, used: 20, unused: 130 });
    assert.deepEqual(rasheed, { allotted: 150, used: 20, unused: 130 });
  });

  it('other verifier does not inherit RC leftover seats', () => {
    assert.deepEqual(
      verificationStageQuotaTotals({
        ...bank,
        actor: { isVerifier: true, actorUid: 'other-verifier' },
      }),
      { allotted: 0, used: 0, unused: 0 },
    );
  });

  it('drops PAS / YJ from allotted and used', () => {
    assert.deepEqual(
      verificationStageQuotaTotals({
        allottedByUid: { rasheed: ['X00090', 'YJ01001'] },
        usedSerials: ['X00090', 'YJ01001'],
        reservedSerials: ['YJ01164'],
        actor: { isRcAdmin: true, actorUid: 'meezan' },
      }),
      { allotted: 1, used: 1, unused: 0 },
    );
  });

  it('VCT unused is picker leftover, allotted/used stay RC GAS seats', () => {
    assert.deepEqual(
      verificationStageQuotaTotals({
        ...bank,
        actor: { isVct: true, actorUid: 'hafiz' },
        vctUnusedCount: 124,
      }),
      { allotted: 150, used: 20, unused: 124 },
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

  it('Vr Allotted range save maps serials to that verifier uid only', () => {
    const add = vrAllottedRangeSerials('X00110', 'X00120');
    const next = nextVerifierAllottedByUid({
      prev: {},
      verifierUid: 'rasheed',
      addSerials: add,
    });
    assert.deepEqual(next, { rasheed: add });
    const reserved = reservedSerialsAfterVerifierAllot({
      reservedSerials: ['X00423', 'X00424'],
      prevAllotted: {},
      nextAllotted: next,
    });
    assert.equal(next.rasheed?.includes('X00423'), false);
    assert.equal(reserved.includes('X00423'), true);
    assert.equal(add.every(serial => reserved.includes(serial)), true);
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

describe('vrAllottedEntrySerials', () => {
  it('returns nothing when start is missing', () => {
    assert.deepEqual(
      vrAllottedEntrySerials({
        usedSerials: ['X00090'],
        serialEnd: 'X00092',
      }),
      [],
    );
  });

  it('marks used vs unused on the inclusive range only', () => {
    assert.deepEqual(
      vrAllottedEntrySerials({
        serialStart: 'X00090',
        serialEnd: 'X00092',
        usedSerials: ['X00090', 'X00999'],
      }),
      [
        { serial: 'X00090', used: true },
        { serial: 'X00091', used: false },
        { serial: 'X00092', used: false },
      ],
    );
  });
});

describe('vrAllottedEntryMatchesFilter', () => {
  it('filters by verifier and used/unused without inventing seats', () => {
    const seats = [{ used: true }, { used: false }];
    assert.equal(
      vrAllottedEntryMatchesFilter({
        verifierUids: ['rasheed'],
        seats,
        verifierFilter: 'other',
      }),
      false,
    );
    assert.equal(
      vrAllottedEntryMatchesFilter({
        verifierUids: ['rasheed'],
        seats,
        statusFilter: 'used',
      }),
      true,
    );
    assert.equal(
      vrAllottedEntryMatchesFilter({
        verifierUids: ['rasheed'],
        seats: [],
        statusFilter: 'unused',
      }),
      false,
    );
  });
});
