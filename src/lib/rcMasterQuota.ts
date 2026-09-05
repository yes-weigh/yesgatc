import { arrayRemove, arrayUnion, doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { isVerificationCertificateVoided } from './verificationCertificateVoid';
import { isVerificationRejected } from './verificationRequest';
import { expandSerialRange, parseQuotaInput, uniqueSerials, unusedSerials } from './yesoneInboundData';
import {
  excludePasQuotaSerials,
  recordUsesPasQuota,
  resolveRcQuotaUsedQty,
} from './rcQuotaMath';
import type { SiteCalibration } from '../types';

export type YesoneReservedAssignment = {
  invoiceNo: string;
  verifierUid: string;
  serialStart?: string;
  serialEnd?: string;
};

export function normalizeReservedAssignments(raw: unknown): YesoneReservedAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: YesoneReservedAssignment[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const invoiceNo = String(row.invoiceNo || '').trim();
    const verifierUid = String(row.verifierUid || '').trim();
    if (!invoiceNo || !verifierUid) continue;
    const key = invoiceNo.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const serialStart = String(row.serialStart || '').trim();
    const serialEnd = String(row.serialEnd || '').trim();
    out.push({
      invoiceNo,
      verifierUid,
      ...(serialStart ? { serialStart, serialEnd: serialEnd || serialStart } : {}),
    });
  }
  return out;
}

export function invoiceAssigneeUid(
  assignments: YesoneReservedAssignment[],
  invoiceNo: string,
): string | null {
  const key = invoiceNo.trim().toUpperCase();
  if (!key) return null;
  const hit = assignments.find(row => row.invoiceNo.trim().toUpperCase() === key);
  return hit?.verifierUid || null;
}

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
  if (isVerificationCertificateVoided(record)) return false;
  if (isVerificationRejected(record)) return false;
  if (recordUsesPasQuota(record.productId, options?.pasProductIds)) return false;
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
};

export function excludeReservedSerials(serials: string[], reserved: string[]): string[] {
  const blocked = new Set(reserved.map(serial => serial.trim().toUpperCase()).filter(Boolean));
  if (blocked.size === 0) return serials;
  return serials.filter(serial => !blocked.has(serial.trim().toUpperCase()));
}

/** RC admin: all. Verifier: reserved only. VCT: public pool only (never reserved). */
export function pickQuotaSerialsForActor(
  seats: Pick<
    RcQuotaSeats,
    'remaining' | 'vctRemaining' | 'reservedForUids' | 'reservedByUid' | 'reservedSerials'
  >,
  actor: {
    isRcAdmin?: boolean;
    isVerifier?: boolean;
    isVct?: boolean;
    actorUid?: string | null;
  },
): string[] {
  if (actor.isRcAdmin) return seats.remaining;
  const uid = String(actor.actorUid || '').trim();
  // Verifier: only RC-reserved seats for this uid — never the public VCT pool.
  if (actor.isVerifier) {
    if (!uid) return [];
    const mine = seats.reservedByUid[uid];
    return mine && mine.length > 0 ? mine : [];
  }
  // VCT: never see verifier-reserved stickers (e.g. Hafiz ≠ Rasheed's range).
  if (actor.isVct) return seats.vctRemaining;
  if (!uid) return seats.vctRemaining;
  const mine = seats.reservedByUid[uid];
  if (mine && mine.length > 0) return mine;
  // Legacy: uid on reservedForUids, no per-invoice map → reserved pool only.
  if (seats.reservedForUids.includes(uid)) {
    return seats.reservedSerials.length > 0 ? seats.reservedSerials : [];
  }
  return seats.vctRemaining;
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
  // Show all unused allotted seats (incl. uninvoiced realloc / RCs without inward invoices).
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
  };
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

export async function toggleReservedSerial(
  rcUid: string,
  serial: string,
  reserved: boolean,
): Promise<void> {
  const trimmed = serial.trim();
  if (!rcUid || !trimmed) return;
  await updateDoc(doc(db, 'users', rcUid), {
    yesoneReservedSerials: reserved ? arrayUnion(trimmed) : arrayRemove(trimmed),
    updatedAt: new Date().toISOString(),
  });
}

export async function toggleReservedInvoice(
  rcUid: string,
  invoiceNo: string,
  reserved: boolean,
): Promise<void> {
  const trimmed = invoiceNo.trim();
  if (!rcUid || !trimmed) return;
  await updateDoc(doc(db, 'users', rcUid), {
    yesoneReservedInvoices: reserved ? arrayUnion(trimmed) : arrayRemove(trimmed),
    updatedAt: new Date().toISOString(),
  });
}

/** Reserve one inward invoice range to one verifier (RC admin + that verifier see serials). */
export async function reserveInvoiceForVerifier(
  rcUid: string,
  input: {
    invoiceNo: string;
    serialStart: string;
    serialEnd: string;
    verifierUid: string;
  },
): Promise<void> {
  const invoiceNo = input.invoiceNo.trim();
  const verifierUid = input.verifierUid.trim();
  if (!rcUid || !invoiceNo || !verifierUid) return;
  const start = input.serialStart.trim();
  const end = (input.serialEnd || input.serialStart).trim();
  const serials = expandSerialRange(start, end);
  const ref = doc(db, 'users', rcUid);
  const snap = await getDoc(ref);
  const prev = normalizeReservedAssignments(snap.data()?.yesoneReservedAssignments);
  const next = [
    ...prev.filter(row => row.invoiceNo.trim().toUpperCase() !== invoiceNo.toUpperCase()),
    {
      invoiceNo,
      verifierUid,
      serialStart: start,
      serialEnd: end,
    },
  ];
  await updateDoc(ref, {
    yesoneReservedInvoices: arrayUnion(invoiceNo),
    yesoneReservedAssignments: next,
    yesoneReservedForUids: arrayUnion(verifierUid),
    updatedAt: new Date().toISOString(),
  });
  // Replace reserved serial list for this invoice range (exact bill qty — no leftovers).
  const otherReserved = uniqueSerials(snap.data()?.yesoneReservedSerials).filter(serial => {
    const key = serial.trim().toUpperCase();
    return !serials.some(item => item.trim().toUpperCase() === key);
  });
  // Keep other invoices' reserved stickers; set this bill's exact expanded set.
  const nextReserved = uniqueSerials([...otherReserved, ...serials]);
  await updateDoc(ref, {
    yesoneReservedSerials: nextReserved,
  });
}

export async function clearInvoiceReservation(
  rcUid: string,
  invoiceNo: string,
  serials: string[],
): Promise<void> {
  const trimmed = invoiceNo.trim();
  if (!rcUid || !trimmed) return;
  const ref = doc(db, 'users', rcUid);
  const snap = await getDoc(ref);
  const prev = normalizeReservedAssignments(snap.data()?.yesoneReservedAssignments);
  const next = prev.filter(row => row.invoiceNo.trim().toUpperCase() !== trimmed.toUpperCase());
  const still = new Set(next.map(row => row.verifierUid));
  const dropUids = uniqueSerials(snap.data()?.yesoneReservedForUids).filter(uid => !still.has(uid));
  await updateDoc(ref, {
    yesoneReservedInvoices: arrayRemove(trimmed),
    yesoneReservedAssignments: next,
    ...(dropUids.length > 0 ? { yesoneReservedForUids: arrayRemove(...dropUids) } : {}),
    updatedAt: new Date().toISOString(),
  });
  const CHUNK = 100;
  const list = uniqueSerials(serials);
  for (let i = 0; i < list.length; i += CHUNK) {
    await updateDoc(ref, {
      yesoneReservedSerials: arrayRemove(...list.slice(i, i + CHUNK)),
    });
  }
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
