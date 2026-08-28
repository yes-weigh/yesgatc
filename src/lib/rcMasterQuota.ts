import { arrayRemove, arrayUnion, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { isVerificationCertificateVoided } from './verificationCertificateVoid';
import { isVerificationRejected } from './verificationRequest';
import { expandSerialRange, parseQuotaInput, uniqueSerials, unusedSerials } from './yesoneInboundData';
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

export type RcQuotaSeats = {
  remaining: string[];
  allottedQty: number | null;
  usedQty: number;
  balanceQty: number | null;
};

export function computeRcQuotaSeats(input: {
  rcCode: string;
  companyName: string;
  ovQuota: string;
  storedSerials: string[];
  allotSerials: string[];
  voidedSerials: string[];
  records: SiteCalibration[];
}): RcQuotaSeats {
  const master = isMasterRc({ rcCode: input.rcCode, companyName: input.companyName });
  const fromStore = uniqueSerials([...input.storedSerials, ...input.allotSerials]);
  const allottedSerials = master
    ? uniqueSerials([
      ...fromStore.filter(serial => !isMasterPoolSerial(serial)),
      ...masterRcPoolSerials(),
    ])
    : fromStore.filter(serial => !isMasterPoolSerial(serial));
  const used = rcOvUsedFromRecords(
    input.records,
    master ? { fromDate: IWP_USED_FROM_DATE } : undefined,
  );
  const remaining = remainingQuotaSerials(allottedSerials, used.serials, input.voidedSerials);
  const allottedQty = master ? masterRcUnusedQty() : parseQuotaInput(input.ovQuota);
  const usedQty = used.count;
  const balanceQty = allottedQty == null ? remaining.length : allottedQty - usedQty;
  return { remaining, allottedQty, usedQty, balanceQty };
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

function serialAllotmentId(serial: string): string {
  return serial.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function rcCodeKey(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
}

/** Unused Meezan G seats moved to other RCs. Idempotent. */
export const MZN_G_REALLOC_MOVES: { rcCode: string; serials: string[] }[] = [
  { rcCode: 'ATL', serials: ['G0535', 'G0536', 'G0537', 'G0538', 'G0539', 'GA111', 'GA112'] },
  { rcCode: 'KNR', serials: ['G0540', 'G0541', 'G0583'] },
  { rcCode: 'DYI', serials: ['G0542', 'G0543', 'G0544', 'G0545', 'G0546', 'G0547'] },
  { rcCode: 'ACE', serials: ['G0548'] },
  { rcCode: 'KTM', serials: ['G0549'] },
];

export function serialReallotmentPending(
  rows: { rcCode: string; storedSerials: string[] }[],
  moves: { rcCode: string; serials: string[] }[],
): boolean {
  const destByCode = new Map(rows.map(row => [rcCodeKey(row.rcCode), row]));
  for (const move of moves) {
    const dest = destByCode.get(rcCodeKey(move.rcCode));
    if (!dest) continue;
    const held = new Set(dest.storedSerials.map(serial => serial.toUpperCase()));
    if (move.serials.some(serial => !held.has(serial.toUpperCase()))) return true;
  }
  return false;
}

export async function applySerialReallotment(
  rows: { uid: string; rcCode: string; companyName?: string; storedSerials: string[] }[],
  moves: { rcCode: string; serials: string[] }[],
): Promise<boolean> {
  const destByCode = new Map(rows.map(row => [rcCodeKey(row.rcCode), row]));
  const nextByUid = new Map(rows.map(row => [row.uid, [...row.storedSerials]]));
  const allot: { serial: string; dest: (typeof rows)[0] }[] = [];
  for (const move of moves) {
    const dest = destByCode.get(rcCodeKey(move.rcCode));
    if (!dest) continue;
    const destList = nextByUid.get(dest.uid);
    if (!destList) continue;
    for (const serial of move.serials) {
      const key = serial.toUpperCase();
      if (destList.some(item => item.toUpperCase() === key)) continue;
      for (const [uid, list] of nextByUid) {
        if (uid === dest.uid) continue;
        const idx = list.findIndex(item => item.toUpperCase() === key);
        if (idx >= 0) list.splice(idx, 1);
      }
      destList.push(serial);
      allot.push({ serial, dest });
    }
  }
  if (!allot.length) return false;
  const now = new Date().toISOString();
  const changed = rows.filter(row => {
    const before = uniqueSerials(row.storedSerials).join('\0');
    const after = uniqueSerials(nextByUid.get(row.uid) || []).join('\0');
    return before !== after;
  });
  await Promise.all(
    changed.map(row =>
      updateDoc(doc(db, 'users', row.uid), {
        yesoneAllottedSerials: uniqueSerials(nextByUid.get(row.uid) || []),
        updatedAt: now,
      }),
    ),
  );
  for (let i = 0; i < allot.length; i += 400) {
    const batch = writeBatch(db);
    for (const row of allot.slice(i, i + 400)) {
      batch.set(doc(db, 'serialAllotments', serialAllotmentId(row.serial)), {
        serialNumber: row.serial,
        rcId: row.dest.uid,
        rcCode: rcCodeKey(row.dest.rcCode),
        rcCompanyName: row.dest.companyName || '',
        status: 'allotted',
        updatedAt: now,
      }, { merge: true });
    }
    await batch.commit();
  }
  return true;
}

export async function rehomeMasterPoolSerials(
  masterUid: string,
  rows: { uid: string; rcCode: string; storedSerials: string[]; ovQuota?: string }[],
): Promise<void> {
  if (!masterUid) return;
  const pool = masterRcPoolSerials();
  const stolen: string[] = [];
  const victims: { uid: string; next: string[] }[] = [];
  for (const row of rows) {
    if (row.uid === masterUid || isMasterRcCode(row.rcCode)) continue;
    const next = row.storedSerials.filter(serial => !isMasterPoolSerial(serial));
    if (next.length === row.storedSerials.length) continue;
    stolen.push(...row.storedSerials.filter(isMasterPoolSerial));
    victims.push({ uid: row.uid, next });
  }
  const master = rows.find(row => row.uid === masterUid);
  const masterKeep = (master?.storedSerials || []).filter(serial => !isMasterPoolSerial(serial));
  const masterNext = uniqueSerials([...masterKeep, ...pool]);
  const masterHasPool = uniqueSerials(master?.storedSerials || []).filter(isMasterPoolSerial).length === pool.length;
  const quotaOk = Number(master?.ovQuota) === pool.length;
  if (!stolen.length && masterHasPool && quotaOk) return;
  const now = new Date().toISOString();
  await Promise.all([
    ...victims.map(row =>
      updateDoc(doc(db, 'users', row.uid), {
        yesoneAllottedSerials: row.next,
        updatedAt: now,
      }),
    ),
    updateDoc(doc(db, 'users', masterUid), {
      yesoneAllottedSerials: masterNext,
      ovQuota: pool.length,
      ovQuotaUpdatedAt: now,
      updatedAt: now,
    }),
  ]);
  const allot = uniqueSerials(stolen);
  for (let i = 0; i < allot.length; i += 400) {
    const batch = writeBatch(db);
    for (const serial of allot.slice(i, i + 400)) {
      const id = serial.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      batch.set(doc(db, 'serialAllotments', id), {
        serialNumber: serial,
        rcId: masterUid,
        rcCode: MASTER_RC_CODE,
        updatedAt: now,
      }, { merge: true });
    }
    await batch.commit();
  }
}
