import { expandSerialRange, parseQuotaInput, uniqueSerials, unusedSerials } from './yesoneInboundData.ts';
import {
  excludePasQuotaSerials,
  recordUsesPasQuota,
  resolveRcQuotaUsedQty,
} from './rcQuotaMath.ts';
import type { SiteCalibration } from '../types.ts';
import { isInterweighingDirectRecord } from './interweighingDirectSerials.ts';

export const MASTER_RC_CODE = 'IWP';

/** Yesone unused series allocated to Master RC IWP. Ignore non GATC (X). */
export const MASTER_RC_UNUSED_RANGES = [
  { from: 'Y10315', to: 'Y11000' },
  { from: 'YZ01420', to: 'YZ01500' },
] as const;

let masterPoolCache: string[] | null = null;

export function masterRcPoolSerials(): string[] {
  if (!masterPoolCache) {
    masterPoolCache = uniqueSerials(
      MASTER_RC_UNUSED_RANGES.flatMap(range => expandSerialRange(range.from, range.to)),
    );
  }
  return masterPoolCache;
}

export function masterRcUnusedQty(): number {
  return masterRcPoolSerials().length;
}

export function isMasterRcCode(code: string): boolean {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3) === MASTER_RC_CODE;
}

export function isMasterRc(row: { rcCode?: string; companyName?: string }): boolean {
  if (isMasterRcCode(row.rcCode || '')) return true;
  return (row.companyName || '').toUpperCase().includes('INTERWEIGHING');
}

const masterPoolUpper = new Set<string>();

function masterPoolUpperSet(): Set<string> {
  if (masterPoolUpper.size === 0) {
    for (const serial of masterRcPoolSerials()) masterPoolUpper.add(serial.toUpperCase());
  }
  return masterPoolUpper;
}

export function isMasterPoolSerial(serial: string): boolean {
  return masterPoolUpperSet().has(serial.trim().toUpperCase());
}

/** IWP Used starts at 0; only OVs from this IST day onward count. */
export const IWP_USED_FROM_DATE = '2026-08-28';

function istDateKey(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

/** OV consumes GAS quota as soon as it exists — including draft. Skip RV, voided, rejected, PAS. */
export function rcOvCountsAsUsed(
  record: SiteCalibration,
  options?: { fromDate?: string; pasProductIds?: Iterable<string> },
): boolean {
  if (record.verificationType === 'RV') return false;
  if (record.certificateVoidedAt?.trim()) return false;
  if (record.status === 'rejected') return false;
  if (recordUsesPasQuota(record.productId, options?.pasProductIds)) return false;
  if (isInterweighingDirectRecord(record)) return false;
  if (options?.fromDate) {
    const key = istDateKey(record.createdAt || '');
    if (!key || key < options.fromDate) return false;
  }
  return true;
}

export function rcOvUsedFromRecords(
  records: SiteCalibration[],
  options?: { fromDate?: string; pasProductIds?: Iterable<string> },
): {
  count: number;
  serials: string[];
} {
  const serials = new Set<string>();
  let extra = 0;
  for (const record of records) {
    if (!rcOvCountsAsUsed(record, options)) continue;
    const serial = String(record.serialNumber || '').trim();
    if (serial) serials.add(serial);
    else extra += 1;
  }
  return { count: serials.size + extra, serials: [...serials] };
}

export function remainingQuotaSerials(
  allotted: string[],
  used: string[],
  voided: string[],
): string[] {
  return unusedSerials(unusedSerials(allotted, used), voided);
}

/** Keep only stickers that have an inward invoice link. Empty set = no filter. */
export function serialsLinkedToInvoice(
  serials: string[],
  invoicedSerials: Iterable<string>,
): string[] {
  const ok = new Set<string>();
  for (const serial of invoicedSerials) {
    const key = String(serial || '').trim().toUpperCase();
    if (key) ok.add(key);
  }
  if (ok.size === 0) return serials;
  return serials.filter(serial => ok.has(serial.trim().toUpperCase()));
}

export type RcQuotaSeats = {
  remaining: string[];
  /** Unused invoiced seats default field staff may pick (excludes reserved). */
  vctRemaining: string[];
  reservedSerials: string[];
  /** Field-staff uids allowed to see reserved pool with RC admin. */
  reservedForUids: string[];
  /** Per-verifier reserved serials (from invoice assignments). */
  reservedByUid: Record<string, string[]>;
  allottedQty: number | null;
  usedQty: number;
  balanceQty: number | null;
  /** Live GAS OV serials that consume quota (PAS jobs excluded). */
  usedSerials: string[];
};

export function excludeReservedSerials(serials: string[], reserved: string[]): string[] {
  const blocked = new Set(reserved.map(serial => serial.trim().toUpperCase()).filter(Boolean));
  if (blocked.size === 0) return serials;
  return serials.filter(serial => !blocked.has(serial.trim().toUpperCase()));
}

export function computeRcQuotaSeats(input: {
  rcCode: string;
  companyName: string;
  ovQuota: string;
  /** YesOne RC-wide used — floor when `records` are incomplete (VCT own-only). */
  ovQuotaUsed?: string | number | null;
  /** True when `records` cover the whole RC (not field-staff own-only). */
  recordsAreRcWide?: boolean;
  storedSerials: string[];
  allotSerials: string[];
  voidedSerials: string[];
  records: SiteCalibration[];
  reservedSerials?: string[];
  reservedForUids?: string[];
  /** Expanded serials per assigned verifier. */
  reservedByUid?: Record<string, string[]>;
  /** PAS catalogue ids — those OVs do not consume GAS RC quota. */
  pasProductIds?: Iterable<string>;
  /** PAS / misfiled bank serials — drop from GAS allotted + remaining. */
  pasSerials?: Iterable<string>;
}): RcQuotaSeats {
  const master = isMasterRc({ rcCode: input.rcCode, companyName: input.companyName });
  const fromStore = excludePasQuotaSerials(
    uniqueSerials([...input.storedSerials, ...input.allotSerials]),
    input.pasSerials,
  );
  const allottedSerials = master
    ? uniqueSerials([
      ...fromStore.filter(serial => !isMasterPoolSerial(serial)),
      ...masterRcPoolSerials(),
    ])
    : fromStore.filter(serial => !isMasterPoolSerial(serial));
  const used = rcOvUsedFromRecords(input.records, {
    ...(master ? { fromDate: IWP_USED_FROM_DATE } : {}),
    pasProductIds: input.pasProductIds,
  });
  const remaining = remainingQuotaSerials(allottedSerials, used.serials, input.voidedSerials);
  const reservedSerials = unusedSerials(
    uniqueSerials(input.reservedSerials || []),
    [...used.serials, ...input.voidedSerials],
  );
  const vctRemaining = excludeReservedSerials(remaining, reservedSerials);
  const reservedForUids = uniqueSerials(input.reservedForUids || []);
  const reservedByUid: Record<string, string[]> = {};
  for (const [uid, serials] of Object.entries(input.reservedByUid || {})) {
    const kept = unusedSerials(uniqueSerials(serials), [...used.serials, ...input.voidedSerials]);
    if (kept.length > 0) reservedByUid[uid] = kept;
  }
  const allottedQty = master ? masterRcUnusedQty() : parseQuotaInput(input.ovQuota);
  const storedUsed = parseQuotaInput(
    input.ovQuotaUsed == null || input.ovQuotaUsed === '' ? '' : String(input.ovQuotaUsed),
  );
  const usedQty = resolveRcQuotaUsedQty({
    recordUsedCount: used.count,
    storedUsed,
    recordsAreRcWide: Boolean(input.recordsAreRcWide),
    allottedQty,
    remainingCount: remaining.length,
  });
  const balanceQty = allottedQty == null ? remaining.length : allottedQty - usedQty;
  return {
    remaining,
    vctRemaining,
    reservedSerials,
    reservedForUids,
    reservedByUid,
    allottedQty,
    usedQty,
    balanceQty,
    usedSerials: excludePasQuotaSerials(used.serials, input.pasSerials),
  };
}
