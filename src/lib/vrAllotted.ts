import { excludePasQuotaSerials } from './rcQuotaMath.ts';
import { expandSerialRange, uniqueSerials } from './yesoneInboundData.ts';
import type { Role } from '../types.ts';

/** RC admin + roster with ≥1 verifier they created. Super Admin / VCT / verifier never. */
export function roleCanOpenVrAllotted(
  role: Role | undefined,
  hasCreatedVerifiers: boolean,
): boolean {
  return role === 'rc_admin' && hasCreatedVerifiers;
}

export function normalizeVerifierAllottedByUid(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [uid, serials] of Object.entries(raw as Record<string, unknown>)) {
    const key = uid.trim();
    if (!key) continue;
    const list = uniqueSerials(serials);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

export function mergeAllottedByUid(
  ...maps: Array<Record<string, string[]> | undefined>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [uid, serials] of Object.entries(map)) {
      const key = uid.trim();
      if (!key) continue;
      const list = uniqueSerials([...(out[key] || []), ...serials]);
      if (list.length > 0) out[key] = list;
    }
  }
  return out;
}

export function flattenAllottedSerials(map: Record<string, string[]>): string[] {
  return uniqueSerials(Object.values(map).flat());
}

function uniqueUids(uids: readonly string[] | undefined): string[] {
  return [...new Set((uids || []).map(uid => uid.trim()).filter(Boolean))];
}

/**
 * Vr Allotted unused greens with uid=null (overlay reserved, no per-uid map).
 * Sole live roster verifier — else sole map uid / reservedForUids when roster is empty —
 * owns those unused reserved seats. Never remaining / RC leftover.
 */
export function assignUnownedReservedToSoleUid(input: {
  allottedByUid: Record<string, string[]>;
  unownedReserved: readonly string[];
  reservedForUids?: readonly string[];
  rosterUids?: readonly string[];
}): Record<string, string[]> {
  const prev = normalizeVerifierAllottedByUid(input.allottedByUid);
  const extra = uniqueSerials(input.unownedReserved);
  if (extra.length === 0) return prev;
  const fromMap = Object.keys(prev);
  const roster = uniqueUids(input.rosterUids);
  const fromReserved = uniqueUids(input.reservedForUids);
  const live = roster.length > 0 ? roster : fromMap.length > 0 ? fromMap : fromReserved;
  if (live.length !== 1) return prev;
  return nextVerifierAllottedByUid({
    prev,
    verifierUid: live[0],
    addSerials: extra,
  });
}

/** Reserved unused not already on a verifier uid map. */
export function unownedReservedSerials(
  reservedSerials: readonly string[],
  allottedByUid: Record<string, string[]>,
): string[] {
  const allottedKeys = new Set(flattenAllottedSerials(allottedByUid).map(serialKey).filter(Boolean));
  return uniqueSerials(reservedSerials).filter(serial => {
    const key = serialKey(serial);
    return Boolean(key) && !allottedKeys.has(key);
  });
}

export type VrAllottedStatusFilter = 'all' | 'unused' | 'used';

/**
 * Tiles + chips. Sole verifier unused = remaining unused already on that uid
 * ∪ unowned reserved unused. Used stays record used. Allotted = used + unused.
 * Two-verifier RCs keep explicit uid; unowned reserved stay uid=null.
 */
export function vrAllottedScopedView(input: {
  allottedByUid: Record<string, string[]>;
  usedSerials: readonly string[];
  voidedSerials?: readonly string[];
  reservedSerials?: readonly string[];
  extraReservedSerials?: readonly string[];
  reservedForUids?: readonly string[];
  rosterUids?: readonly string[];
  verifierFilter?: string;
  statusFilter?: VrAllottedStatusFilter;
}): {
  allottedByUid: Record<string, string[]>;
  allSeats: VrAllottedSeat[];
  seats: VrAllottedSeat[];
  totals: VrAllottedTotals;
} {
  const extra = uniqueSerials([
    ...(input.extraReservedSerials || []),
    ...unownedReservedSerials(input.reservedSerials || [], input.allottedByUid),
  ]);
  const allottedByUid = assignUnownedReservedToSoleUid({
    allottedByUid: input.allottedByUid,
    unownedReserved: extra,
    reservedForUids: input.reservedForUids,
    rosterUids: input.rosterUids,
  });
  const allSeats = vrAllottedSeatList({
    allottedByUid,
    usedSerials: input.usedSerials,
    voidedSerials: input.voidedSerials,
    extraReservedSerials: extra,
  });
  const verifierFilter = (input.verifierFilter || 'all').trim();
  const statusFilter = input.statusFilter || 'all';
  const seats = allSeats.filter(seat => {
    if (verifierFilter !== 'all' && seat.uid !== verifierFilter) return false;
    if (statusFilter === 'unused') return !seat.used;
    if (statusFilter === 'used') return seat.used;
    return true;
  });
  const totals = seats.reduce(
    (acc, seat) => ({
      allotted: acc.allotted + 1,
      used: acc.used + (seat.used ? 1 : 0),
      unused: acc.unused + (seat.used ? 0 : 1),
    }),
    { allotted: 0, used: 0, unused: 0 },
  );
  return { allottedByUid, allSeats, seats, totals };
}

function gasSerials(serials: readonly string[]): string[] {
  return excludePasQuotaSerials([...serials], []);
}

function gasAllottedByUid(map: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [uid, serials] of Object.entries(map)) {
    const list = gasSerials(serials);
    if (list.length > 0) out[uid] = list;
  }
  return out;
}

/**
 * VERIFICATION STAGES Allotted / Used / Balance.
 * Same bank as Vr Allotted tiles (used + unused reserved). PAS / YJ dropped.
 * Verifier = that uid only. VCT unused = picker leftover (`vctUnusedCount`).
 */
export function verificationStageQuotaTotals(input: {
  allottedByUid: Record<string, string[]>;
  usedSerials: readonly string[];
  voidedSerials?: readonly string[];
  reservedSerials?: readonly string[];
  reservedForUids?: readonly string[];
  rosterUids?: readonly string[];
  actor: {
    isRcAdmin?: boolean;
    isVerifier?: boolean;
    isVct?: boolean;
    actorUid?: string | null;
  };
  vctUnusedCount?: number;
}): VrAllottedTotals {
  const actorUid = String(input.actor.actorUid || '').trim();
  const scoped = vrAllottedScopedView({
    allottedByUid: gasAllottedByUid(input.allottedByUid),
    usedSerials: gasSerials(input.usedSerials),
    voidedSerials: input.voidedSerials,
    reservedSerials: gasSerials(input.reservedSerials || []),
    reservedForUids: input.reservedForUids,
    rosterUids: input.rosterUids,
    verifierFilter: input.actor.isVerifier ? actorUid || '__none__' : 'all',
  });
  if (input.actor.isVct) {
    return {
      allotted: scoped.totals.allotted,
      used: scoped.totals.used,
      unused: Math.max(0, input.vctUnusedCount ?? 0),
    };
  }
  return scoped.totals;
}

export function vrAllottedRangeSerials(start: string, end: string): string[] {
  const from = start.trim();
  const to = (end || start).trim();
  if (!from) return [];
  return expandSerialRange(from, to);
}

export function vrAllottedRangeQty(start: string, end: string): number {
  return vrAllottedRangeSerials(start, end).length;
}

export function vrAllottedRangeFullyInPool(
  start: string,
  end: string,
  pool: readonly string[],
): boolean {
  const serials = vrAllottedRangeSerials(start, end);
  if (serials.length === 0) return false;
  const keys = new Set(pool.map(serial => serial.trim().toUpperCase()).filter(Boolean));
  return serials.every(serial => keys.has(serial.trim().toUpperCase()));
}

export type VrAllottedRow = {
  uid: string;
  allotted: number;
  used: number;
  unused: number;
  unusedSerials: string[];
  usedSerials: string[];
};

export type VrAllottedTotals = {
  allotted: number;
  used: number;
  unused: number;
};

export type VrAllottedSeat = {
  serial: string;
  /** Verifier uid, or null when extra reserved is not on a roster allotment. */
  uid: string | null;
  used: boolean;
};

function serialKey(serial: string): string {
  return serial.trim().toUpperCase();
}

export function vrAllottedStatus(input: {
  allottedByUid: Record<string, string[]>;
  usedSerials: readonly string[];
  voidedSerials?: readonly string[];
  verifierUids: readonly string[];
  /** Unused reserved seats not already on a verifier — still allotted unused. */
  extraReservedSerials?: readonly string[];
}): { rows: VrAllottedRow[]; totals: VrAllottedTotals } {
  const usedKeys = new Set(
    input.usedSerials.map(serialKey).filter(Boolean),
  );
  const voidedKeys = new Set(
    (input.voidedSerials || []).map(serialKey).filter(Boolean),
  );

  const rows: VrAllottedRow[] = input.verifierUids.map(uid => {
    const allotted = uniqueSerials(input.allottedByUid[uid] || []);
    const usedSerials = allotted.filter(serial => usedKeys.has(serialKey(serial)));
    const unusedSerials = allotted.filter(serial => {
      const key = serialKey(serial);
      return !usedKeys.has(key) && !voidedKeys.has(key);
    });
    return {
      uid,
      allotted: allotted.length,
      used: usedSerials.length,
      unused: unusedSerials.length,
      unusedSerials,
      usedSerials,
    };
  });

  const allottedKeys = new Set(
    Object.values(input.allottedByUid)
      .flat()
      .map(serialKey)
      .filter(Boolean),
  );
  const extraReserved = uniqueSerials(input.extraReservedSerials || []).filter(serial => {
    const key = serialKey(serial);
    return Boolean(key) && !allottedKeys.has(key);
  });
  const all = uniqueSerials([...Object.values(input.allottedByUid).flat(), ...extraReserved]);
  const used = all.filter(serial => usedKeys.has(serialKey(serial)));
  const unused = all.filter(serial => {
    const key = serialKey(serial);
    return !usedKeys.has(key) && !voidedKeys.has(key);
  });

  return {
    rows,
    totals: { allotted: all.length, used: used.length, unused: unused.length },
  };
}

/** Allotted stickers: verifier seats + extra reserved unused. Voided omitted. */
export function vrAllottedSeatList(input: {
  allottedByUid: Record<string, string[]>;
  usedSerials: readonly string[];
  voidedSerials?: readonly string[];
  extraReservedSerials?: readonly string[];
}): VrAllottedSeat[] {
  const usedKeys = new Set(input.usedSerials.map(serialKey).filter(Boolean));
  const voidedKeys = new Set((input.voidedSerials || []).map(serialKey).filter(Boolean));
  const uidByKey = new Map<string, string>();
  for (const [uid, serials] of Object.entries(input.allottedByUid)) {
    const owner = uid.trim();
    if (!owner) continue;
    for (const serial of uniqueSerials(serials)) {
      const key = serialKey(serial);
      if (key && !uidByKey.has(key)) uidByKey.set(key, owner);
    }
  }
  const allottedKeys = new Set(uidByKey.keys());
  const extra = uniqueSerials(input.extraReservedSerials || []).filter(serial => {
    const key = serialKey(serial);
    return Boolean(key) && !allottedKeys.has(key);
  });
  const all = uniqueSerials([...Object.values(input.allottedByUid).flat(), ...extra]);
  const seats: VrAllottedSeat[] = [];
  for (const serial of all) {
    const key = serialKey(serial);
    if (!key || voidedKeys.has(key)) continue;
    seats.push({
      serial,
      uid: uidByKey.get(key) ?? null,
      used: usedKeys.has(key),
    });
  }
  return seats;
}

/** Unused GAS seats this verifier may receive. Other roster members' seats stay blocked. */
export function allottableVerifierSerials(input: {
  remaining: readonly string[];
  allottedByUid: Record<string, string[]>;
  verifierUid: string;
  rosterUids?: readonly string[];
}): string[] {
  const verifierUid = input.verifierUid.trim();
  const roster = input.rosterUids
    ? new Set(input.rosterUids.map(uid => uid.trim()).filter(Boolean))
    : null;
  const blocked = new Set<string>();
  for (const [uid, serials] of Object.entries(input.allottedByUid)) {
    if (uid === verifierUid) continue;
    if (roster && !roster.has(uid)) continue;
    for (const serial of serials) {
      const key = serialKey(serial);
      if (key) blocked.add(key);
    }
  }
  return uniqueSerials(
    input.remaining.filter(serial => !blocked.has(serialKey(serial))),
  );
}

export function nextVerifierAllottedByUid(input: {
  prev: Record<string, string[]>;
  verifierUid: string;
  addSerials: readonly string[];
  removeSerials?: readonly string[];
}): Record<string, string[]> {
  const verifierUid = input.verifierUid.trim();
  if (!verifierUid) return normalizeVerifierAllottedByUid(input.prev);
  const add = uniqueSerials(input.addSerials);
  const addKeys = new Set(add.map(serialKey));
  const removeKeys = new Set(
    uniqueSerials(input.removeSerials || []).map(serialKey),
  );

  const next: Record<string, string[]> = {};
  for (const [uid, serials] of Object.entries(input.prev)) {
    if (uid === verifierUid) continue;
    const kept = serials.filter(serial => !addKeys.has(serialKey(serial)));
    if (kept.length > 0) next[uid] = uniqueSerials(kept);
  }

  const current = uniqueSerials(input.prev[verifierUid] || []);
  const keptMine = current.filter(serial => !removeKeys.has(serialKey(serial)));
  const mine = uniqueSerials([...keptMine, ...add]);
  if (mine.length > 0) next[verifierUid] = mine;
  return next;
}

export function reservedSerialsAfterVerifierAllot(input: {
  reservedSerials: readonly string[];
  prevAllotted: Record<string, string[]>;
  nextAllotted: Record<string, string[]>;
}): string[] {
  const prevKeys = new Set(flattenAllottedSerials(input.prevAllotted).map(serialKey));
  const nextList = flattenAllottedSerials(input.nextAllotted);
  const nextKeys = new Set(nextList.map(serialKey));
  const kept = uniqueSerials(input.reservedSerials).filter(serial => {
    const key = serialKey(serial);
    if (nextKeys.has(key)) return true;
    if (prevKeys.has(key) && !nextKeys.has(key)) return false;
    return true;
  });
  return uniqueSerials([...kept, ...nextList]);
}

export function mergeSerialLists(base: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const serial of [...base, ...extra]) {
    const key = serialKey(serial);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(serial.trim());
  }
  return out;
}
