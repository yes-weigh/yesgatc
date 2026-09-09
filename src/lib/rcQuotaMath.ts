import { isGasStickerSerial, isPasStickerSerial } from './pasSerialBankMatch.ts';
import { mergeSerialLists } from './vrAllotted.ts';

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

/**
 * OV GAS stickers for a job.
 * RC: full unused pool (incl. reserved).
 * VCT: parent unused minus reserved (RC-admin-only + verifier-allotted stay hidden).
 * Verifier: parent unused plus their allotted — never shrink to allotted-only.
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
  const uid = String(actor.actorUid || '').trim();
  const mine = uid ? seats.reservedByUid[uid] || [] : [];
  if (actor.isVct) return seats.vctRemaining;
  if (actor.isVerifier) return mergeSerialLists(seats.vctRemaining, mine);
  if (!uid) return seats.remaining;
  if (mine.length > 0) return mine;
  if (seats.reservedForUids.includes(uid)) {
    return seats.reservedSerials.length > 0 ? seats.reservedSerials : seats.remaining;
  }
  return seats.remaining;
}
