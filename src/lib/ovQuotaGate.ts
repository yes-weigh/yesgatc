export type OvQuotaGate = {
  remaining: string[];
  balanceQty: number | null;
  heldSerials: string[];
};

function serialKey(value: string): string {
  return value.trim().toUpperCase();
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
