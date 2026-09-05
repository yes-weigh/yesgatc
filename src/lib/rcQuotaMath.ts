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
  if (!pasSerials) return serials;
  const blocked = new Set(
    [...pasSerials].map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  if (blocked.size === 0) return serials;
  return serials.filter(serial => !blocked.has(serial.trim().toUpperCase()));
}
