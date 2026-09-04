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
  return want.some(token => have.some(hit => hit === token || hit.includes(token) || token.includes(hit)));
}

/** Prefer stickers for this GATC product. Legacy rows with no product stay visible. If none match, keep the full remaining list so OV is not blocked. */
export function remainingSerialsForProduct(
  remaining: string[],
  allotments: OvQuotaAllotment[] | undefined,
  product: { productId?: string; productName?: string; sku?: string; modelNo?: string } | null,
): string[] {
  const productId = String(product?.productId || '').trim();
  const productName = String(product?.productName || '').trim();
  if (!productId && !productName) return remaining;
  if (!Array.isArray(allotments) || allotments.length === 0) return remaining;
  const bySerial = new Map(allotments.map(row => [serialKey(row.serialNumber), row]));
  const matched = remaining.filter(serial => {
    const row = bySerial.get(serialKey(serial));
    if (!row) return true;
    if (!row.sku && !row.productId && !row.productName && !row.modelNo) return true;
    return productMatchesAllotment(product || {}, row);
  });
  return matched.length ? matched : remaining;
}

/** New OV seats left: min(Allotted − Used, unused stickers). */
export function ovQuotaSeatCap(gate: OvQuotaGate): number {
  const remainingCount = gate.remaining.length;
  const fromBalance = gate.balanceQty == null ? remainingCount : Math.max(0, gate.balanceQty);
  return Math.min(fromBalance, remainingCount);
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
): string | null {
  if (!gate || verificationType !== 'OV' || !isNew) return null;
  if (ovQuotaSeatCap(gate) <= 0) {
    return 'OV quota balance is 0. Cannot start Original Verification.';
  }
  return null;
}

export function validateOvQuotaDevices(
  verificationType: string,
  serials: string[],
  gate: OvQuotaGate | null | undefined,
): string | null {
  if (!gate || verificationType !== 'OV') return null;
  const held = new Set(gate.heldSerials.map(serialKey).filter(Boolean));
  const remaining = new Set(gate.remaining.map(serialKey).filter(Boolean));
  const seen = new Set<string>();
  let newCount = 0;
  for (const raw of serials) {
    const serial = raw.trim();
    if (!serial) {
      newCount += 1;
      continue;
    }
    const key = serialKey(serial);
    if (seen.has(key)) return `Serial ${serial} is used more than once.`;
    seen.add(key);
    if (held.has(key)) continue;
    if (!remaining.has(key)) {
      return `Serial ${serial} is not in allotted balance. Use an allotted serial for OV.`;
    }
    newCount += 1;
  }
  const cap = ovQuotaSeatCap(gate);
  if (newCount > cap) {
    return cap <= 0
      ? 'OV quota balance is 0. Cannot start more Original Verifications.'
      : `OV quota: ${cap} left. You can start ${cap} more Original Verification(s).`;
  }
  return null;
}
