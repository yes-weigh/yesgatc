import { arrayUnion, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { InterweighingDirectBatch, Product } from '../types';
import { isGasStickerSerial, isPasStickerSerial } from './pasSerialBankMatch';
import {
  expandDirectSerialInput,
  nextInterweighingDirectSerials,
} from './interweighingDirectSerials';
import { vrAllottedAssignmentSerials } from './vrAllotted';

export async function allotInterweighingDirectSerials(input: {
  verifierUid: string;
  allottedByUid: string;
  serialStart: string;
  serialEnd: string;
  listText?: string;
  serials?: readonly string[];
  productType?: 'gas' | 'pas';
  product?: Pick<Product, 'id' | 'name' | 'modelid' | 'yesoneSku'> | null;
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
  const productType = input.productType === 'pas' ? 'pas' : 'gas';
  const serials = vrAllottedAssignmentSerials({
    serialStart: input.serialStart,
    serialEnd: input.serialEnd,
    listText: input.listText,
    serials: input.serials,
  });
  const listed = expandDirectSerialInput({
    serialStart: input.serialStart,
    serialEnd: input.serialEnd,
    listText: input.listText,
  });
  const resolved = serials.length > 0 ? serials : listed;
  if (resolved.length === 0) throw new Error('Enter a serial range or list.');
  if (productType === 'pas' && resolved.some(serial => isGasStickerSerial(serial))) {
    throw new Error('PAS allotment cannot use GAS X/G serials.');
  }
  if (productType === 'gas' && resolved.some(serial => isPasStickerSerial(serial))) {
    throw new Error('GAS allotment cannot use PAS serials.');
  }
  if (productType === 'pas' && !String(input.product?.id || '').trim()) {
    throw new Error('Select a PAS product.');
  }
  const ref = doc(db, 'users', verifierUid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Verifier is required.');
  const previousSerials = input.previousSerials ?? snap.data()?.interweighingDirectSerials;
  const batch: InterweighingDirectBatch = {
    serialStart: input.serialStart.trim() || resolved[0],
    serialEnd: (input.serialEnd || input.serialStart).trim() || resolved[resolved.length - 1],
    qty: resolved.length,
    serials: resolved,
    allottedAt: input.allottedAt?.trim() || new Date().toISOString(),
    allottedByUid: input.allottedByUid.trim(),
    productType,
  };
  if (productType === 'pas' && input.product) {
    batch.productId = input.product.id;
    batch.productName = input.product.name;
    batch.modelid = input.product.modelid;
    if (input.product.yesoneSku?.trim()) batch.yesoneSku = input.product.yesoneSku.trim();
  }
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
  const nextSerials =
    productType === 'pas'
      ? nextInterweighingDirectSerials(previousSerials, [])
      : nextInterweighingDirectSerials(previousSerials, resolved);
  await updateDoc(ref, {
    ...(productType === 'pas' ? {} : { interweighingDirectSerials: nextSerials }),
    interweighingDirectBatches: arrayUnion(batch),
    updatedAt: new Date().toISOString(),
  });
  return { serials: resolved, qty: resolved.length, nextSerials, batch };
}
