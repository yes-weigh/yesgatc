/** Fixed prefix for GATC Kerala laboratory seal identification numbers. */
export const LABORATORY_SEAL_PREFIX = 'IND/GATC/KL/26/04/';

/** Legacy prefix (pre-GATC segment) — still accepted when parsing stored values. */
const LEGACY_LABORATORY_SEAL_PREFIX = 'IND/KL/26/04/';

export type LaboratorySealQuarter = 'A' | 'B' | 'C' | 'D';

const DEFAULT_LABORATORY_SEAL_SEQUENCE = 26;

/** A Jan–Mar · B Apr–Jun · C Jul–Sep · D Oct–Dec */
export function quarterLetterForMonth(monthIndex: number): LaboratorySealQuarter {
  if (monthIndex <= 2) return 'A';
  if (monthIndex <= 5) return 'B';
  if (monthIndex <= 8) return 'C';
  return 'D';
}

export function quarterLetterForDate(date: Date = new Date()): LaboratorySealQuarter {
  return quarterLetterForMonth(date.getMonth());
}

export function parseLaboratorySealSequence(value?: string | null): number {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return DEFAULT_LABORATORY_SEAL_SEQUENCE;

  let suffix = trimmed;
  if (trimmed.startsWith(LABORATORY_SEAL_PREFIX)) {
    suffix = trimmed.slice(LABORATORY_SEAL_PREFIX.length);
  } else if (trimmed.startsWith(LEGACY_LABORATORY_SEAL_PREFIX)) {
    suffix = trimmed.slice(LEGACY_LABORATORY_SEAL_PREFIX.length);
  } else {
    suffix = trimmed.split('/').pop() ?? trimmed;
  }

  const match = suffix.match(/^([A-D])(\d+)$/i);
  if (!match) return DEFAULT_LABORATORY_SEAL_SEQUENCE;

  const sequence = parseInt(match[2], 10);
  return Number.isFinite(sequence) && sequence > 0
    ? sequence
    : DEFAULT_LABORATORY_SEAL_SEQUENCE;
}

export function formatLaboratorySealId(
  sequenceNumber: number,
  referenceDate: Date = new Date(),
): string {
  const sequence = Number.isFinite(sequenceNumber) && sequenceNumber > 0
    ? Math.trunc(sequenceNumber)
    : DEFAULT_LABORATORY_SEAL_SEQUENCE;
  const letter = quarterLetterForDate(referenceDate);
  return `${LABORATORY_SEAL_PREFIX}${letter}${sequence}`;
}

export const LABORATORY_SEAL_QUARTER_HINT =
  'IND/GATC/KL/26/04/ is fixed. Quarter letter: A Jan–Mar, B Apr–Jun, C Jul–Sep, D Oct–Dec.';
