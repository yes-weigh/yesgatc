export type OvQuotaProductRef = {
  productId?: string;
  productName?: string;
  sku?: string;
  modelNo?: string;
  modelid?: string;
  modelId?: string;
};

export type OvQuotaAllotment = {
  serialNumber: string;
  sku?: string;
  productId?: string;
  productName?: string;
  modelNo?: string;
  modelId?: string;
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

function productTokens(value: OvQuotaProductRef | OvQuotaAllotment | null | undefined): string[] {
  if (!value) return [];
  const row = value as OvQuotaProductRef & OvQuotaAllotment;
  return [row.productId, row.sku, row.modelNo, row.modelid, row.modelId, row.productName]
    .map(item => compactProductToken(String(item || '')))
    .filter(Boolean);
}

function productMatchesAllotment(
  product: OvQuotaProductRef,
  row: OvQuotaAllotment,
): boolean {
  const want = productTokens(product);
  const have = productTokens(row);
  if (!have.length) return true;
  if (!want.length) return false;
  return want.some(token => have.includes(token));
}

/** Prefer stickers for this GATC product. Legacy rows with no product stay visible. */
export function remainingSerialsForProduct(
  remaining: string[],
  allotments: OvQuotaAllotment[] | undefined,
  product: OvQuotaProductRef | null,
): string[] {
  if (productTokens(product).length === 0) return remaining;
  if (!Array.isArray(allotments) || allotments.length === 0) return remaining;
  const bySerial = new Map(allotments.map(row => [serialKey(row.serialNumber), row]));
  return remaining.filter(serial => {
    const row = bySerial.get(serialKey(serial));
    if (!row) return true;
    if (productTokens(row).length === 0) return true;
    return productMatchesAllotment(product || {}, row);
  });
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
