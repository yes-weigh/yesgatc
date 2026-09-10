import { isGasStickerSerial, isPasStickerSerial } from './pasSerialBankMatch.ts';

/** GAS RC quota qty. PAS seats never consume or inflate these numbers. */

export function resolveRcQuotaUsedQty(input: {
  recordUsedCount: number;
  storedUsed: number | null;
  recordsAreRcWide: boolean;
  allottedQty: number | null;
  remainingCount: number;
}): number {
  const recordUsed = Math.max(0, input.recordUsedCount);
  let usedQty =
    input.storedUsed == null
      ? recordUsed
      : input.recordsAreRcWide
        ? recordUsed
        : Math.max(recordUsed, input.storedUsed);

  // Stale YesOne ovQuotaUsed often equals Allotted. Unused GAS seats stay unused.
  if (input.allottedQty != null && input.remainingCount > 0) {
    const seatUsed = Math.max(0, input.allottedQty - input.remainingCount);
    if (usedQty > seatUsed) usedQty = Math.max(recordUsed, seatUsed);
  }
  return usedQty;
}

export function recordUsesPasQuota(
  productId: string | undefined | null,
  pasProductIds: Iterable<string> | undefined,
): boolean {
  const id = String(productId || '').trim();
  if (!id || !pasProductIds) return false;
  const set =
    pasProductIds instanceof Set
      ? pasProductIds
      : new Set([...pasProductIds].map(item => String(item).trim()).filter(Boolean));
  return set.has(id);
}

export function excludePasQuotaSerials(
  serials: string[],
  pasSerials: Iterable<string> | undefined,
): string[] {
  const blocked = new Set(
    [...(pasSerials || [])].map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  return serials.filter(serial => {
    const key = serial.trim().toUpperCase();
    if (!key) return false;
    if (isPasStickerSerial(key)) return false;
    if (isGasStickerSerial(key)) return true;
    return !blocked.has(key);
  });
}

/** Reserved chips currently shown on the RC serial overlay (not leftovers off-list). */
export function countReservedOverlaySeats(
  serials: readonly string[],
  reservedSerials: readonly string[],
  voidedSerials: readonly string[] = [],
): number {
  const voided = new Set(
    voidedSerials.map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  const reserved = new Set(
    reservedSerials.map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  return serials.filter(serial => {
    const key = serial.trim().toUpperCase();
    if (!key || voided.has(key)) return false;
    return reserved.has(key);
  }).length;
}

export type QuotaSerialActorSeats = {
  remaining: string[];
  vctRemaining: string[];
  reservedSerials: string[];
  reservedForUids: string[];
  reservedByUid: Record<string, string[]>;
};

function serialKey(serial: string): string {
  return serial.trim().toUpperCase();
}

/** Unused GAS bank: parent remaining + unused reserved (Vr Allotted green). */
function unusedGasBank(seats: QuotaSerialActorSeats): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const serial of [...seats.remaining, ...seats.reservedSerials]) {
    const key = serialKey(serial);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(serial.trim());
  }
  return out;
}

/**
 * Unused seats explicitly allotted to this verifier uid.
 * Intersection with unused bank — never invent, never dump unreserved RC remaining.
 */
function unusedAllottedToUid(seats: QuotaSerialActorSeats, uid: string): string[] {
  if (!uid) return [];
  const mine = new Set<string>();
  for (const serial of seats.reservedByUid[uid] || []) {
    const key = serialKey(serial);
    if (key) mine.add(key);
  }
  if (mine.size === 0) return [];
  return unusedGasBank(seats).filter(serial => mine.has(serialKey(serial)));
}

/**
 * OV GAS stickers for a job. Product/SKU is not applied here — GAS unused is one bank.
 * RC: full unused pool (incl. reserved).
 * VCT: parent unused minus reserved (RC-admin-only + verifier-allotted stay hidden).
 * Verifier: unused seats reserved to actorUid only. Empty reserved → empty list.
 * Never leftover remaining that was never on this uid (e.g. X00423).
 */
export function pickQuotaSerialsForActor(
  seats: QuotaSerialActorSeats,
  actor: {
    isRcAdmin?: boolean;
    isVerifier?: boolean;
    isVct?: boolean;
    actorUid?: string | null;
  },
): string[] {
  if (actor.isRcAdmin) return seats.remaining;
  if (actor.isVct) return seats.vctRemaining;
  const uid = String(actor.actorUid || '').trim();
  const mine = uid ? unusedAllottedToUid(seats, uid) : [];
  if (actor.isVerifier) return mine;
  if (!uid) return seats.remaining;
  if (mine.length > 0) return mine;
  if (seats.reservedForUids.includes(uid)) {
    return seats.reservedSerials.length > 0 ? seats.reservedSerials : seats.remaining;
  }
  return seats.remaining;
}
