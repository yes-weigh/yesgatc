import { uniqueSerials } from './yesoneInboundData.ts';
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

function serialKey(serial: string): string {
  return serial.trim().toUpperCase();
}

export function vrAllottedStatus(input: {
  allottedByUid: Record<string, string[]>;
  usedSerials: readonly string[];
  voidedSerials?: readonly string[];
  verifierUids: readonly string[];
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

  const all = uniqueSerials(Object.values(input.allottedByUid).flat());
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
