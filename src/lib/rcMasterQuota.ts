import { arrayRemove, arrayUnion, doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { expandSerialRange, uniqueSerials } from './yesoneInboundData';
import {
  nextVerifierAllottedByUid,
  normalizeVerifierAllottedByUid,
  reservedSerialsAfterVerifierAllot,
  vrAllottedRangeSerials,
} from './vrAllotted.ts';
import {
  MASTER_RC_CODE,
  isMasterPoolSerial,
  isMasterRcCode,
  masterRcPoolSerials,
} from './rcQuotaSeats.ts';

export {
  IWP_USED_FROM_DATE,
  MASTER_RC_CODE,
  MASTER_RC_UNUSED_RANGES,
  computeRcQuotaSeats,
  excludeReservedSerials,
  isMasterPoolSerial,
  isMasterRc,
  isMasterRcCode,
  masterRcPoolSerials,
  masterRcUnusedQty,
  rcOvCountsAsUsed,
  rcOvUsedFromRecords,
  remainingQuotaSerials,
  serialsLinkedToInvoice,
  type RcQuotaSeats,
} from './rcQuotaSeats.ts';

export type YesoneReservedAssignment = {
  invoiceNo: string;
  verifierUid: string;
  verifierUids?: string[];
  serialStart?: string;
  serialEnd?: string;
  allottedAt?: string;
  invoiceUrl?: string;
  invoicePath?: string;
  invoiceName?: string;
  invoiceContentType?: string;
};

export type ReservedAssignmentInvoiceFile = {
  url: string;
  path?: string;
  name?: string;
  contentType?: string;
};

function reservedAssignmentInvoiceFields(
  invoice?: ReservedAssignmentInvoiceFile | null,
): Pick<
  YesoneReservedAssignment,
  'invoiceUrl' | 'invoicePath' | 'invoiceName' | 'invoiceContentType'
> {
  const url = invoice?.url?.trim() || '';
  const path = invoice?.path?.trim() || '';
  const name = invoice?.name?.trim() || '';
  const contentType = invoice?.contentType?.trim() || '';
  return {
    ...(url ? { invoiceUrl: url } : {}),
    ...(path ? { invoicePath: path } : {}),
    ...(name ? { invoiceName: name } : {}),
    ...(contentType ? { invoiceContentType: contentType } : {}),
  };
}

function invoiceFileFromAssignment(
  row?: YesoneReservedAssignment,
): ReservedAssignmentInvoiceFile | undefined {
  if (!row?.invoiceUrl && !row?.invoicePath) return undefined;
  return {
    url: row.invoiceUrl || '',
    path: row.invoicePath,
    name: row.invoiceName,
    contentType: row.invoiceContentType,
  };
}

export function normalizeReservedAssignments(raw: unknown): YesoneReservedAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: YesoneReservedAssignment[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const invoiceNo = String(row.invoiceNo || '').trim();
    const extraUids = Array.isArray(row.verifierUids)
      ? row.verifierUids.map(uid => String(uid || '').trim()).filter(Boolean)
      : [];
    const verifierUid = String(row.verifierUid || extraUids[0] || '').trim();
    if (!invoiceNo || !verifierUid) continue;
    const key = invoiceNo.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const serialStart = String(row.serialStart || '').trim();
    const serialEnd = String(row.serialEnd || '').trim();
    const allottedAt = String(row.allottedAt || row.date || '').trim();
    const verifierUids = [...new Set([verifierUid, ...extraUids])];
    out.push({
      invoiceNo,
      verifierUid,
      ...(verifierUids.length > 1 ? { verifierUids } : {}),
      ...(serialStart ? { serialStart, serialEnd: serialEnd || serialStart } : {}),
      ...(allottedAt ? { allottedAt } : {}),
      ...reservedAssignmentInvoiceFields({
        url: String(row.invoiceUrl || '').trim(),
        path: String(row.invoicePath || '').trim(),
        name: String(row.invoiceName || '').trim(),
        contentType: String(row.invoiceContentType || '').trim(),
      }),
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

export { pickQuotaSerialsForActor } from './rcQuotaMath';

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

/**
 * Allot unused GAS seats to a verifier this RC created.
 * Writes `yesoneVerifierAllottedByUid` + keeps those seats in `yesoneReservedSerials`
 * (hidden from VCT). Does not invent serials — `allowedSerials` is the RC unused pool.
 */
export async function allotGasSerialsToVerifier(input: {
  rcUid: string;
  verifierUid: string;
  addSerials: string[];
  removeSerials?: string[];
  allowedSerials: string[];
}): Promise<void> {
  const rcUid = input.rcUid.trim();
  const verifierUid = input.verifierUid.trim();
  if (!rcUid || !verifierUid) return;
  const allowed = new Set(uniqueSerials(input.allowedSerials).map(serial => serial.trim().toUpperCase()));
  const ref = doc(db, 'users', rcUid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  const prev = normalizeVerifierAllottedByUid(data.yesoneVerifierAllottedByUid);
  const mine = uniqueSerials(prev[verifierUid] || []);
  const addSerials = uniqueSerials(input.addSerials).filter(serial => {
    const key = serial.trim().toUpperCase();
    return allowed.has(key) || mine.some(item => item.trim().toUpperCase() === key);
  });
  const removeSerials = uniqueSerials(input.removeSerials || []).filter(serial =>
    mine.some(item => item.trim().toUpperCase() === serial.trim().toUpperCase()),
  );
  const next = nextVerifierAllottedByUid({ prev, verifierUid, addSerials, removeSerials });
  const nextReserved = reservedSerialsAfterVerifierAllot({
    reservedSerials: uniqueSerials(data.yesoneReservedSerials),
    prevAllotted: prev,
    nextAllotted: next,
  });
  const assignmentUids = normalizeReservedAssignments(data.yesoneReservedAssignments).map(
    row => row.verifierUid.trim(),
  );
  const nextForUids = [...new Set([...assignmentUids, ...Object.keys(next)].filter(Boolean))];
  await updateDoc(ref, {
    yesoneVerifierAllottedByUid: next,
    yesoneReservedSerials: nextReserved,
    yesoneReservedForUids: nextForUids,
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

export async function saveVerifierInvoiceAllotment(input: {
  rcUid: string;
  invoiceNo: string;
  prevInvoiceNo?: string;
  serialStart: string;
  serialEnd: string;
  verifierUids: string[];
  allottedAt?: string;
  allowedSerials: string[];
  invoice?: ReservedAssignmentInvoiceFile | null;
}): Promise<void> {
  const rcUid = input.rcUid.trim();
  const invoiceNo = input.invoiceNo.trim();
  const verifierUids = [...new Set(input.verifierUids.map(uid => uid.trim()).filter(Boolean))];
  const start = input.serialStart.trim();
  const end = (input.serialEnd || input.serialStart).trim();
  if (!rcUid || !invoiceNo || !start || verifierUids.length === 0) {
    throw new Error('Verifier, invoice, and serial range are required.');
  }
  const serials = uniqueSerials(vrAllottedRangeSerials(start, end));
  if (serials.length === 0) {
    throw new Error('Serial range is empty.');
  }
  const allowed = new Set(
    uniqueSerials(input.allowedSerials).map(serial => serial.trim().toUpperCase()),
  );
  if (serials.some(serial => !allowed.has(serial.trim().toUpperCase()))) {
    throw new Error('Must be unused RC seats.');
  }

  const ref = doc(db, 'users', rcUid);
  const snap = await getDoc(ref);
  const data = snap.data() || {};
  const prevAssignments = normalizeReservedAssignments(data.yesoneReservedAssignments);
  const prevInvoiceKey = (input.prevInvoiceNo || invoiceNo).trim().toUpperCase();
  const nextInvoiceKey = invoiceNo.toUpperCase();
  const prevRow = prevAssignments.find(
    row => row.invoiceNo.trim().toUpperCase() === prevInvoiceKey,
  );
  const oldSerials = prevRow?.serialStart
    ? uniqueSerials(vrAllottedRangeSerials(prevRow.serialStart, prevRow.serialEnd || prevRow.serialStart))
    : [];
  const oldKeys = new Set(oldSerials.map(serial => serial.trim().toUpperCase()));

  const nextAssignments: YesoneReservedAssignment[] = [
    ...prevAssignments.filter(row => {
      const key = row.invoiceNo.trim().toUpperCase();
      return key !== prevInvoiceKey && key !== nextInvoiceKey;
    }),
    {
      invoiceNo,
      verifierUid: verifierUids[0],
      ...(verifierUids.length > 1 ? { verifierUids } : {}),
      serialStart: start,
      serialEnd: end,
      ...(input.allottedAt?.trim() ? { allottedAt: input.allottedAt.trim() } : {}),
      ...reservedAssignmentInvoiceFields(
        input.invoice === undefined ? invoiceFileFromAssignment(prevRow) : input.invoice,
      ),
    },
  ];

  const nextReserved = uniqueSerials([
    ...uniqueSerials(data.yesoneReservedSerials).filter(
      serial => !oldKeys.has(serial.trim().toUpperCase()),
    ),
    ...serials,
  ]);

  const invoiceSeen = new Set<string>();
  const nextInvoices: string[] = [];
  const prevInvoices = Array.isArray(data.yesoneReservedInvoices)
    ? data.yesoneReservedInvoices
    : [];
  for (const item of [...prevInvoices, invoiceNo]) {
    const label = String(item || '').trim();
    const key = label.toUpperCase();
    if (!label || key === prevInvoiceKey && key !== nextInvoiceKey) continue;
    if (invoiceSeen.has(key)) continue;
    invoiceSeen.add(key);
    nextInvoices.push(label);
  }

  let allotted = normalizeVerifierAllottedByUid(data.yesoneVerifierAllottedByUid);
  if (oldSerials.length > 0) {
    for (const uid of Object.keys(allotted)) {
      allotted = nextVerifierAllottedByUid({
        prev: allotted,
        verifierUid: uid,
        addSerials: [],
        removeSerials: oldSerials,
      });
    }
  }
  for (const uid of verifierUids) {
    allotted = nextVerifierAllottedByUid({
      prev: allotted,
      verifierUid: uid,
      addSerials: serials,
    });
  }

  const assignmentUids = [
    ...new Set(
      nextAssignments.flatMap(row =>
        row.verifierUids && row.verifierUids.length > 0 ? row.verifierUids : [row.verifierUid],
      ),
    ),
  ];

  await updateDoc(ref, {
    yesoneReservedAssignments: nextAssignments,
    yesoneReservedInvoices: nextInvoices,
    yesoneReservedSerials: nextReserved,
    yesoneVerifierAllottedByUid: allotted,
    yesoneReservedForUids: assignmentUids,
    updatedAt: new Date().toISOString(),
  });
}

/** Attach / replace Yesone invoice file on an existing allotment row. Serials unchanged. */
export async function attachReservedAssignmentInvoice(input: {
  rcUid: string;
  invoiceNo: string;
  invoice: ReservedAssignmentInvoiceFile;
}): Promise<void> {
  const rcUid = input.rcUid.trim();
  const invoiceNo = input.invoiceNo.trim();
  const fields = reservedAssignmentInvoiceFields(input.invoice);
  if (!rcUid || !invoiceNo || !fields.invoiceUrl && !fields.invoicePath) {
    throw new Error('Invoice file is required.');
  }
  const ref = doc(db, 'users', rcUid);
  const snap = await getDoc(ref);
  const prev = normalizeReservedAssignments(snap.data()?.yesoneReservedAssignments);
  const key = invoiceNo.toUpperCase();
  const idx = prev.findIndex(row => row.invoiceNo.trim().toUpperCase() === key);
  if (idx < 0) {
    throw new Error('Allotment not found.');
  }
  const next = [...prev];
  next[idx] = { ...prev[idx], ...fields };
  await updateDoc(ref, {
    yesoneReservedAssignments: next,
    updatedAt: new Date().toISOString(),
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
