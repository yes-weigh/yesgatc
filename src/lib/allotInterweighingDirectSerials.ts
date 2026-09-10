import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { InterweighingDirectBatch } from '../types';
import {
  expandDirectSerialInput,
  nextInterweighingDirectSerials,
} from './interweighingDirectSerials';

export async function allotInterweighingDirectSerials(input: {
  verifierUid: string;
  allottedByUid: string;
  serialStart: string;
  serialEnd: string;
  listText?: string;
  invoiceNo?: string;
  allottedAt?: string;
  previousSerials?: unknown;
  invoice?: {
    url?: string;
    path?: string;
    name?: string;
    contentType?: string;
  } | null;
}): Promise<{ serials: string[]; qty: number; nextSerials: string[]; batch: InterweighingDirectBatch }> {
  const verifierUid = input.verifierUid.trim();
  if (!verifierUid) throw new Error('Verifier is required.');
  const serials = expandDirectSerialInput({
    serialStart: input.serialStart,
    serialEnd: input.serialEnd,
    listText: input.listText,
  });
  if (serials.length === 0) throw new Error('Enter a serial range or list.');
  const ref = doc(db, 'users', verifierUid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Verifier is required.');
  const previousSerials = input.previousSerials ?? snap.data()?.interweighingDirectSerials;
  const batch: InterweighingDirectBatch = {
    serialStart: input.serialStart.trim() || serials[0],
    serialEnd: (input.serialEnd || input.serialStart).trim() || serials[serials.length - 1],
    qty: serials.length,
    allottedAt: input.allottedAt?.trim() || new Date().toISOString(),
    allottedByUid: input.allottedByUid.trim(),
  };
  const invoiceNo = input.invoiceNo?.trim();
  if (invoiceNo) batch.invoiceNo = invoiceNo;
  const url = input.invoice?.url?.trim();
  const path = input.invoice?.path?.trim();
  const name = input.invoice?.name?.trim();
  const contentType = input.invoice?.contentType?.trim();
  if (url) batch.invoiceUrl = url;
  if (path) batch.invoicePath = path;
  if (name) batch.invoiceName = name;
  if (contentType) batch.invoiceContentType = contentType;
  const nextSerials = nextInterweighingDirectSerials(previousSerials, serials);
  await updateDoc(ref, {
    interweighingDirectSerials: nextSerials,
    interweighingDirectBatches: arrayUnion(batch),
    updatedAt: new Date().toISOString(),
  });
  return { serials, qty: serials.length, nextSerials, batch };
}
