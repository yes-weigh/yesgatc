import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { isVerificationCertificateVoided } from './verificationCertificateVoid';
import { isVerificationRejected } from './verificationRequest';
import { expandSerialRange, uniqueSerials, unusedSerials } from './yesoneInboundData';
import type { SiteCalibration } from '../types';

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

export function isMasterRcCode(code: string): boolean {
  return code.trim().toUpperCase() === MASTER_RC_CODE;
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

/** OV consumes quota as soon as it exists — including draft. Skip RV, voided, rejected. */
export function rcOvCountsAsUsed(
  record: SiteCalibration,
  options?: { fromDate?: string },
): boolean {
  if (record.verificationType === 'RV') return false;
  if (isVerificationCertificateVoided(record)) return false;
  if (isVerificationRejected(record)) return false;
  if (options?.fromDate) {
    const key = istDateKey(record.createdAt || '');
    if (!key || key < options.fromDate) return false;
  }
  return true;
}

export function rcOvUsedFromRecords(
  records: SiteCalibration[],
  options?: { fromDate?: string },
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

export async function toggleVoidedSerial(
  rcUid: string,
  serial: string,
  voided: boolean,
): Promise<void> {
  const trimmed = serial.trim();
  if (!rcUid || !trimmed) return;
  await updateDoc(doc(db, 'users', rcUid), {
    yesoneVoidedSerials: voided ? arrayUnion(trimmed) : arrayRemove(trimmed),
    updatedAt: new Date().toISOString(),
  });
}
