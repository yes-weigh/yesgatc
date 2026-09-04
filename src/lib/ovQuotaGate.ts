export type OvQuotaAllotment = {
  serialNumber: string;
  sku?: string;
  productId?: string;
  productName?: string;
  modelNo?: string;
};

export type OvQuotaGate = {
  remaining: string[];
  remainingAllotments?: OvQuotaAllotment[];
  balanceQty: number | null;
  heldSerials: string[];
};

function serialKey(value: string): string {
  return value.trim().toUpperCase();
}

function compactProductToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function productMatchesAllotment(
  product: { productId?: string; productName?: string; sku?: string; modelNo?: string },
  row: OvQuotaAllotment,
): boolean {
  const want = [product.productId, product.sku, product.modelNo, product.productName]
    .map(item => compactProductToken(String(item || '')))
    .filter(Boolean);
  const have = [row.productId, row.sku, row.modelNo, row.productName]
    .map(item => compactProductToken(String(item || '')))
    .filter(Boolean);
  if (!have.length) return true;
  if (!want.length) return false;
  return want.some(token => have.includes(token));
}

/** Prefer stickers for this GATC product. Legacy rows with no product stay visible. */
export function remainingSerialsForProduct(
  remaining: string[],
  allotments: OvQuotaAllotment[] | undefined,
  product: { productId?: string; productName?: string; sku?: string; modelNo?: string } | null,
): string[] {
  const productId = String(product?.productId || '').trim();
  const productName = String(product?.productName || '').trim();
  const sku = String(product?.sku || '').trim();
  if (!productId && !productName && !sku) return remaining;
  if (!Array.isArray(allotments) || allotments.length === 0) return remaining;
  const bySerial = new Map(allotments.map(row => [serialKey(row.serialNumber), row]));
  return remaining.filter(serial => {
    const row = bySerial.get(serialKey(serial));
    if (!row) return true;
    if (!row.sku && !row.productId && !row.productName && !row.modelNo) return true;
    return productMatchesAllotment(product || {}, row);
  });
}

/** OV quantity left (Allotted − Used). PAS and GAS both consume this. */
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
  if (ovQuotaQtyCap(gate) <= 0) {
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
      ? 'No allotted serials left. Use a PAS product or wait for serial allotment.'
      : `Allotted serials: ${stickers} left. You can start ${stickers} more GAS Original Verification(s).`;
  }
  const qtyCap = ovQuotaQtyCap(gate);
  if (newGas + newPas > qtyCap) {
    return qtyCap <= 0
      ? 'OV quota balance is 0. Cannot start more Original Verifications.'
      : `OV quota: ${qtyCap} left. You can start ${qtyCap} more Original Verification(s).`;
  }
  return null;
}
