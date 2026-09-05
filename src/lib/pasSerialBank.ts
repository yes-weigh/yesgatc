import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Product, SiteCalibration } from '../types';
import {
  finitePasCount,
  mergePasBankCounts,
  mergePasBankUsage,
  pasBankListedForProduct,
  pasBankMatchesProduct,
  summarizeSerialRows,
  usageFromSerialRows,
  type PasBankDoc,
  type PasBankUsage,
  type ProductSerialBankSummary,
  type ProductSerialRow,
} from './pasSerialBankMatch';

export const PAS_SERIAL_BANK_COLLECTION = 'pasSerialBank';
export const PAS_SERIAL_BANK_META_COLLECTION = 'pasSerialBankMeta';

export {
  mergePasBankCounts,
  mergePasBankUsage,
  pasBankListedForProduct,
  pasBankMatchesProduct,
  serialInInclusiveRange,
  usageFromSerialRows,
  type PasBankDoc,
  type PasBankUsage,
  type ProductSerialBankSummary,
  type ProductSerialRow,
} from './pasSerialBankMatch';

export type PasCheckRow = {
  included?: boolean;
  productId?: string;
  serialNumber?: string;
};

export function productUsesPasSerials(product: Product | null | undefined): boolean {
  return Boolean(product?.pasPreAllotted);
}

export function catalogueHasPasProducts(products: readonly Product[] | undefined): boolean {
  return Boolean(products?.some(productUsesPasSerials));
}

export function pasProductIdSet(products: readonly Product[] | undefined): Set<string> {
  return new Set(
    (products || []).filter(productUsesPasSerials).map(product => product.id).filter(Boolean),
  );
}

export type PasAllotmentIdentity = {
  serialNumber: string;
  productId?: string;
  sku?: string;
  modelNo?: string;
  productName?: string;
  pool?: string;
};

export function allotmentUsesPasProduct(
  row: PasAllotmentIdentity,
  pasProducts: readonly Product[],
): boolean {
  if (String(row.pool || '').trim().toLowerCase() === 'pas') return true;
  if (pasProducts.length === 0) return false;
  const productId = String(row.productId || '').trim();
  if (productId && pasProducts.some(product => product.id === productId)) return true;
  return pasProducts.some(product =>
    pasBankMatchesProduct(
      {
        productId: row.productId,
        yesoneSku: row.sku,
        sku: row.sku,
      },
      product,
    ),
  );
}

export function pasSerialsFromAllotments(
  rows: readonly PasAllotmentIdentity[],
  products: readonly Product[] | undefined,
): string[] {
  const pasProducts = (products || []).filter(productUsesPasSerials);
  if (pasProducts.length === 0) {
    return rows
      .filter(row => String(row.pool || '').trim().toLowerCase() === 'pas')
      .map(row => row.serialNumber);
  }
  return rows.filter(row => allotmentUsesPasProduct(row, pasProducts)).map(row => row.serialNumber);
}

export function pasSerialDocId(serial: string): string | null {
  const trimmed = serial.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase().replace(/[/\\]/g, '_').slice(0, 700);
}

export function quotaSerialRows(
  devices: PasCheckRow[],
  products: readonly Product[] | undefined,
): Array<{ serial: string; pas: boolean }> {
  return devices
    .filter(row => row.included !== false)
    .map(row => {
      const product = products?.find(item => item.id === row.productId) ?? null;
      return {
        serial: row.serialNumber ?? '',
        pas: productUsesPasSerials(product),
      };
    });
}

function pasStatusError(serial: string, status: string): string | null {
  const key = status.trim().toLowerCase();
  if (!key || key === 'available' || key === 'allotted') return null;
  if (key === 'used') return `Serial ${serial} is already used.`;
  return `Serial ${serial} is not available.`;
}

function firebaseDenied(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      String((err as { code: unknown }).code).includes('permission-denied'),
  );
}

export async function verifyPasSerialInBank(
  serial: string,
  product: Product,
): Promise<string | null> {
  const trimmed = serial.trim();
  const id = pasSerialDocId(trimmed);
  if (!id) return 'Serial number is required.';
  try {
    const snap = await getDoc(doc(db, PAS_SERIAL_BANK_COLLECTION, id));
    if (!snap.exists()) return `Serial ${trimmed} is not in the PAS number bank.`;
    const data = (snap.data() || {}) as PasBankDoc;
    const statusError = pasStatusError(trimmed, String(data.status || ''));
    if (statusError) return statusError;
    if (!pasBankMatchesProduct(data, product)) {
      return `Serial ${trimmed} is not allotted to this PAS product.`;
    }
    return null;
  } catch (err) {
    if (firebaseDenied(err)) {
      return 'PAS number bank is blocked. Super admin must deploy Firestore rules.';
    }
    return err instanceof Error ? err.message : 'Could not check PAS number bank.';
  }
}

export async function verifyPasDevicesInBank(
  devices: PasCheckRow[],
  products: readonly Product[] | undefined,
): Promise<string | null> {
  const seen = new Set<string>();
  for (const row of devices) {
    if (row.included === false) continue;
    const product = products?.find(item => item.id === row.productId) ?? null;
    if (!productUsesPasSerials(product) || !product) continue;
    const serial = (row.serialNumber || '').trim();
    if (!serial) continue;
    const key = serial.toUpperCase();
    if (seen.has(key)) return `Serial ${serial} is used more than once.`;
    seen.add(key);
    const error = await verifyPasSerialInBank(serial, product);
    if (error) return error;
  }
  return null;
}

export function calibrationRowsForPasCheck(
  records: Array<Pick<SiteCalibration, 'productId' | 'serialNumber'>>,
): PasCheckRow[] {
  return records.map(record => ({
    included: true,
    productId: record.productId,
    serialNumber: record.serialNumber,
  }));
}

export async function markPasSerialUsed(options: {
  serial: string;
  product: Product;
  uid?: string | null;
  rcId?: string | null;
  recordId?: string | null;
}): Promise<void> {
  const trimmed = options.serial.trim();
  const id = pasSerialDocId(trimmed);
  if (!id) return;
  const ref = doc(db, PAS_SERIAL_BANK_COLLECTION, id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw new Error(`Serial ${trimmed} is not in the PAS number bank.`);
    }
    const data = (snap.data() || {}) as PasBankDoc;
    const status = String(data.status || '').trim().toLowerCase();
    if (status === 'used') {
      if (options.recordId && data.usedRecordId === options.recordId) return;
      throw new Error(`Serial ${trimmed} is already used.`);
    }
    const statusError = pasStatusError(trimmed, status);
    if (statusError) throw new Error(statusError);
    if (!pasBankMatchesProduct(data, options.product)) {
      throw new Error(`Serial ${trimmed} is not allotted to this PAS product.`);
    }
    tx.update(ref, {
      status: 'used',
      usedAt: new Date().toISOString(),
      usedByUid: options.uid || null,
      usedByRcId: options.rcId || null,
      usedRecordId: options.recordId || null,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function markPasSerialsUsedForRows(
  rows: Array<{ productId?: string; serialNumber?: string; recordId?: string; rcId?: string }>,
  products: readonly Product[] | undefined,
  meta: { uid?: string | null; rcId?: string | null },
): Promise<void> {
  for (const row of rows) {
    const product = products?.find(item => item.id === row.productId) ?? null;
    if (!productUsesPasSerials(product) || !product) continue;
    const serial = (row.serialNumber || '').trim();
    if (!serial) continue;
    await markPasSerialUsed({
      serial,
      product,
      uid: meta.uid,
      rcId: row.rcId || meta.rcId,
      recordId: row.recordId,
    });
  }
}

function serialSortKey(a: ProductSerialRow, b: ProductSerialRow): number {
  return a.serial.localeCompare(b.serial, undefined, { numeric: true, sensitivity: 'base' });
}

function pasRowFromSnap(
  id: string,
  data: PasBankDoc,
  product: Product,
  range?: { from?: string; to?: string } | null,
): ProductSerialRow | null {
  if (!pasBankListedForProduct(data, product, range)) return null;
  const serial = String(data.serialNumber || id).trim();
  if (!serial) return null;
  return {
    id,
    serial,
    status: String(data.status || 'available'),
    pool: 'pas',
    invoiceNo: data.invoiceNo,
    bankQty: finitePasCount(data.bankQty) ?? undefined,
    bankLinked: finitePasCount(data.bankLinked) ?? undefined,
    bankUnused: finitePasCount(data.bankUnused) ?? undefined,
    serialFrom: data.serialFrom,
    serialTo: data.serialTo,
  };
}

function metaDocIdsForProduct(product: Product): string[] {
  return [product.yesoneSku, product.id, product.modelid]
    .map(value => pasSerialDocId(String(value || '')))
    .filter((id): id is string => Boolean(id));
}

async function loadPasBankMeta(product: Product): Promise<PasBankUsage | null> {
  for (const id of metaDocIdsForProduct(product)) {
    try {
      const snap = await getDoc(doc(db, PAS_SERIAL_BANK_META_COLLECTION, id));
      if (!snap.exists()) continue;
      const data = (snap.data() || {}) as PasBankUsage & { linked?: number; unused?: number };
      return {
        qty: finitePasCount(data.qty),
        linked: finitePasCount(data.linked),
        unused: finitePasCount(data.unused),
        from: data.from,
        to: data.to,
      };
    } catch (err) {
      if (firebaseDenied(err)) continue;
      throw err;
    }
  }
  return null;
}

async function queryPasBank(product: Product): Promise<{
  rows: ProductSerialRow[];
  usage: PasBankUsage | null;
}> {
  const col = collection(db, PAS_SERIAL_BANK_COLLECTION);
  const [listed, meta] = await Promise.all([getDocs(col), loadPasBankMeta(product)]);
  const snaps = listed.docs.map(docSnap => ({
    id: docSnap.id,
    data: (docSnap.data() || {}) as PasBankDoc,
  }));
  const tagged: ProductSerialRow[] = [];
  for (const snap of snaps) {
    const row = pasRowFromSnap(snap.id, snap.data, product);
    if (row) tagged.push(row);
  }
  const usage = mergePasBankUsage(meta, usageFromSerialRows(tagged));
  const range = usage?.from && usage.to ? { from: usage.from, to: usage.to } : null;
  const byId = new Map<string, ProductSerialRow>();
  for (const snap of snaps) {
    const row = pasRowFromSnap(snap.id, snap.data, product, range);
    if (row) byId.set(row.id, row);
  }
  return { rows: [...byId.values()].sort(serialSortKey), usage };
}

async function queryGasAllotments(product: Product): Promise<ProductSerialRow[]> {
  const col = collection(db, 'serialAllotments');
  const filters = [query(col, where('productId', '==', product.id))];
  const sku = product.yesoneSku?.trim();
  const modelNo = product.modelNo?.trim();
  if (sku) filters.push(query(col, where('sku', '==', sku)));
  if (modelNo) filters.push(query(col, where('modelNo', '==', modelNo)));

  const snaps = await Promise.all(filters.map(item => getDocs(item)));
  const byId = new Map<string, ProductSerialRow>();
  for (const snap of snaps) {
    for (const docSnap of snap.docs) {
      const data = (docSnap.data() || {}) as {
        serialNumber?: string;
        status?: string;
        invoiceNo?: string;
        productId?: string;
        sku?: string;
        modelNo?: string;
      };
      const serial = String(data.serialNumber || docSnap.id).trim();
      if (!serial) continue;
      byId.set(docSnap.id, {
        id: docSnap.id,
        serial,
        status: String(data.status || 'allotted'),
        pool: 'gas',
        invoiceNo: data.invoiceNo,
      });
    }
  }
  return [...byId.values()].sort(serialSortKey);
}

export async function listProductSerialBank(product: Product): Promise<ProductSerialBankSummary> {
  try {
    if (productUsesPasSerials(product)) {
      const { rows, usage } = await queryPasBank(product);
      return mergePasBankCounts(rows, usage);
    }
    return summarizeSerialRows(await queryGasAllotments(product));
  } catch (err) {
    if (firebaseDenied(err)) {
      throw new Error('Serial bank is blocked. Super admin must deploy Firestore rules.');
    }
    throw err instanceof Error ? err : new Error('Could not load serial numbers.');
  }
}
