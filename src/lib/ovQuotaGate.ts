export type OvQuotaAllotment = {
  serialNumber: string;
  sku?: string;
  productId?: string;
  productName?: string;
  modelNo?: string;
  pool?: string;
};

export type OvQuotaGate = {
  remaining: string[];
  remainingAllotments?: OvQuotaAllotment[];
  balanceQty: number | null;
  heldSerials: string[];
  /** Verifier job: remaining is that uid's unused allotment only. */
  scopedToVerifier?: boolean;
};

function serialKey(value: string): string {
  return value.trim().toUpperCase();
}

function allotmentPool(row: Pick<OvQuotaAllotment, 'pool'>): string {
  return String(row.pool || '').trim().toLowerCase();
}

/**
 * Unused GAS stickers are one bank for every GAS product.
 * Yesone sku / productId / model must not hide seats (Bench PC vs other GAS SKU).
 * PAS-pool stickers never appear here.
 */
export function remainingSerialsForProduct(
  remaining: string[],
  allotments: OvQuotaAllotment[] | undefined,
  product?: { productId?: string; productName?: string; sku?: string; modelNo?: string } | null,
): string[] {
  void product;
  if (!Array.isArray(allotments) || allotments.length === 0) return remaining;
  const pasKeys = new Set<string>();
  for (const row of allotments) {
    if (allotmentPool(row) !== 'pas') continue;
    const key = serialKey(row.serialNumber);
    if (key) pasKeys.add(key);
  }
  if (pasKeys.size === 0) return remaining;
  return remaining.filter(serial => !pasKeys.has(serialKey(serial)));
}

/** GAS OV quantity left (Allotted − Used). PAS does not consume this. */
export function ovQuotaQtyCap(gate: OvQuotaGate): number {
  return gate.balanceQty == null ? gate.remaining.length : Math.max(0, gate.balanceQty);
}

/** New GAS seats left: min(qty, unused stickers). PAS does not use stickers. */
export function ovQuotaSeatCap(gate: OvQuotaGate): number {
  return Math.min(ovQuotaQtyCap(gate), gate.remaining.length);
}

export function ovSerialChoicesForRow(
  current: string,
  remaining: string[],
  heldSerials: string[],
  otherTaken: string[],
): string[] {
  const taken = new Set(otherTaken.map(serialKey).filter(Boolean));
  const keep = serialKey(current);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const serial of [...remaining, ...heldSerials, current]) {
    const trimmed = serial.trim();
    if (!trimmed) continue;
    const key = serialKey(trimmed);
    if (seen.has(key)) continue;
    if (taken.has(key) && key !== keep) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function validateOvQuotaSetup(
  verificationType: string,
  gate: OvQuotaGate | null | undefined,
  isNew: boolean,
  hasPasProducts = false,
): string | null {
  if (!gate || verificationType !== 'OV' || !isNew) return null;
  if (gate.scopedToVerifier && !hasPasProducts && gate.remaining.length <= 0) {
    return 'No serials allotted to you. Cannot start Original Verification.';
  }
  if (ovQuotaQtyCap(gate) <= 0 && !hasPasProducts) {
    return 'OV quota balance is 0. Cannot start Original Verification.';
  }
  if (!hasPasProducts && gate.remaining.length <= 0) {
    return 'No allotted serials left. Cannot start Original Verification.';
  }
  return null;
}

export type OvQuotaDeviceRow = {
  serial: string;
  pas?: boolean;
};

export function validateOvQuotaDevices(
  verificationType: string,
  rows: OvQuotaDeviceRow[],
  gate: OvQuotaGate | null | undefined,
): string | null {
  if (!gate || verificationType !== 'OV') return null;
  const held = new Set(gate.heldSerials.map(serialKey).filter(Boolean));
  const remaining = new Set(gate.remaining.map(serialKey).filter(Boolean));
  const seen = new Set<string>();
  let newGas = 0;
  let newPas = 0;
  for (const row of rows) {
    const serial = (row.serial || '').trim();
    const pas = Boolean(row.pas);
    if (!serial) {
      if (pas) newPas += 1;
      else newGas += 1;
      continue;
    }
    const key = serialKey(serial);
    if (seen.has(key)) return `Serial ${serial} is used more than once.`;
    seen.add(key);
    if (held.has(key)) continue;
    if (pas) {
      newPas += 1;
      continue;
    }
    if (!remaining.has(key)) {
      return `Serial ${serial} is not in allotted balance. Use an allotted serial for OV.`;
    }
    newGas += 1;
  }
  if (newGas > gate.remaining.length) {
    const stickers = gate.remaining.length;
    return stickers <= 0
      ? gate.scopedToVerifier
        ? 'No serials allotted to you. Use a PAS product or wait for allotment.'
        : 'No allotted serials left. Use a PAS product or wait for serial allotment.'
      : `Allotted serials: ${stickers} left. You can start ${stickers} more GAS Original Verification(s).`;
  }
  const qtyCap = ovQuotaQtyCap(gate);
  if (newGas > qtyCap) {
    return qtyCap <= 0
      ? 'OV quota balance is 0. Cannot start more GAS Original Verifications.'
      : `OV quota: ${qtyCap} left. You can start ${qtyCap} more GAS Original Verification(s).`;
  }
  return null;
}
