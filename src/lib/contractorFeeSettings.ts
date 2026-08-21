/** RC pays contractor per certified instrument. Schedule is dated; edits never rewrite past days. */

export const CONTRACTOR_FEE_EPOCH = '2026-02-01';

/** Rates already used on reports before Setting existed. */
export const CONTRACTOR_FEE_LEGACY = {
  upto20Kg: 100,
  above20Kg: 200,
  handlingFee: 0,
} as const;

/** Form default and first save target. */
export const CONTRACTOR_FEE_DEFAULT = {
  upto20Kg: 150,
  above20Kg: 250,
  handlingFee: 0,
} as const;

export type ContractorFeeRates = {
  upto20Kg: number;
  above20Kg: number;
  handlingFee: number;
};

export type ContractorFeeScheduleEntry = ContractorFeeRates & {
  effectiveFrom: string;
};

export type ContractorFeeSettings = {
  contractorFeeSchedules: ContractorFeeScheduleEntry[];
};

export const DEFAULT_CONTRACTOR_FEE_SETTINGS: ContractorFeeSettings = {
  contractorFeeSchedules: [],
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeContractorFeeAmountInr(value: unknown, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.round(parsed), 999_999);
}

/** Handling fee may be 0 (hidden on report until set). */
export function normalizeContractorFeeZeroAmountInr(value: unknown, fallback: number): number {
  if (value === '' || value == null) return fallback;
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value).replace(/\D/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.round(parsed), 999_999);
}

function normalizeDateKey(value: unknown): string | null {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (!DATE_KEY.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }
  return raw;
}

function normalizeEntry(raw: unknown): ContractorFeeScheduleEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const effectiveFrom = normalizeDateKey(row.effectiveFrom);
  if (!effectiveFrom) return null;
  const upto20Kg = normalizeContractorFeeAmountInr(row.upto20Kg, 0);
  const above20Kg = normalizeContractorFeeAmountInr(row.above20Kg, 0);
  if (upto20Kg < 1 || above20Kg < 1) return null;
  const handlingFee = normalizeContractorFeeZeroAmountInr(row.handlingFee, 0);
  return { effectiveFrom, upto20Kg, above20Kg, handlingFee };
}

export function normalizeContractorFeeSchedules(raw: unknown): ContractorFeeScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  const byDate = new Map<string, ContractorFeeScheduleEntry>();
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (!entry) continue;
    byDate.set(entry.effectiveFrom, entry);
  }
  return [...byDate.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export function normalizeContractorFeeSettings(
  data: Partial<ContractorFeeSettings> | undefined,
): ContractorFeeSettings {
  return {
    contractorFeeSchedules: normalizeContractorFeeSchedules(data?.contractorFeeSchedules),
  };
}

export function contractorFeeForDate(
  schedules: ContractorFeeScheduleEntry[],
  dateKey: string,
): ContractorFeeRates {
  let current: ContractorFeeRates = CONTRACTOR_FEE_LEGACY;
  for (const row of schedules) {
    if (row.effectiveFrom <= dateKey) {
      current = {
        upto20Kg: row.upto20Kg,
        above20Kg: row.above20Kg,
        handlingFee: row.handlingFee ?? 0,
      };
    }
  }
  return current;
}

export function contractorFeeForForm(
  schedules: ContractorFeeScheduleEntry[],
  todayKey = localDateKey(),
): ContractorFeeRates {
  if (schedules.length === 0) return { ...CONTRACTOR_FEE_DEFAULT };
  return contractorFeeForDate(schedules, todayKey);
}

function withLegacyEpoch(schedules: ContractorFeeScheduleEntry[]): ContractorFeeScheduleEntry[] {
  if (schedules.some(row => row.effectiveFrom <= CONTRACTOR_FEE_EPOCH)) return schedules;
  return [
    {
      effectiveFrom: CONTRACTOR_FEE_EPOCH,
      upto20Kg: CONTRACTOR_FEE_LEGACY.upto20Kg,
      above20Kg: CONTRACTOR_FEE_LEGACY.above20Kg,
      handlingFee: CONTRACTOR_FEE_LEGACY.handlingFee,
    },
    ...schedules,
  ];
}

function ratesEqual(a: ContractorFeeRates, b: ContractorFeeRates): boolean {
  return (
    a.upto20Kg === b.upto20Kg &&
    a.above20Kg === b.above20Kg &&
    a.handlingFee === b.handlingFee
  );
}

/** Append or replace today's row. Never mutates earlier dates. */
export function contractorFeeSchedulesAfterSave(
  existing: ContractorFeeScheduleEntry[],
  next: ContractorFeeRates,
  todayKey = localDateKey(),
): ContractorFeeScheduleEntry[] {
  const seeded = withLegacyEpoch(existing);
  const withoutToday = seeded.filter(row => row.effectiveFrom !== todayKey);
  const liveWithoutToday = contractorFeeForDate(withoutToday, todayKey);
  if (ratesEqual(liveWithoutToday, next)) return withoutToday;
  return [...withoutToday, { effectiveFrom: todayKey, ...next }].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
}

export function formatContractorFeeEffectiveLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
