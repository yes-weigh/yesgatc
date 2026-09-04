import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Product, SiteCalibration } from '../types';

export const PAS_SERIAL_BANK_COLLECTION = 'pasSerialBank';

export type PasBankDoc = {
  serialNumber?: string;
  status?: string;
  productId?: string;
  productName?: string;
  yesoneSku?: string;
  sku?: string;
  modelid?: string;
  modelId?: string;
  modelNo?: string;
  modelApprovalNo?: string;
  invoiceNo?: string;
  qty?: number;
  usedRecordId?: string;
};

export type ProductSerialRow = {
  id: string;
  serial: string;
  status: string;
  pool: 'pas' | 'gas';
  invoiceNo?: string;
};

export type ProductSerialBankSummary = {
  rows: ProductSerialRow[];
  qty: number;
  available: number;
  used: number;
  cancelled: number;
};

export type PasCheckRow = {
  included?: boolean;
  productId?: string;
  serialNumber?: string;
};

function norm(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

export function productUsesPasSerials(product: Product | null | undefined): boolean {
  return Boolean(product?.pasPreAllotted);
}

export function catalogueHasPasProducts(products: readonly Product[] | undefined): boolean {
  return Boolean(products?.some(productUsesPasSerials));
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

function addIdentityKey(set: Set<string>, value?: string | null): void {
  const raw = norm(value);
  if (!raw) return;
  set.add(raw);
  const compact = raw.replace(/[^a-z0-9]/g, '');
  if (compact) set.add(compact);
}

function identityKeys(row: {
  id?: string;
  productId?: string;
  yesoneSku?: string;
  sku?: string;
  modelid?: string;
  modelId?: string;
  modelNo?: string;
  modelApprovalNo?: string;
}): Set<string> {
  const out = new Set<string>();
  addIdentityKey(out, row.id);
  addIdentityKey(out, row.productId);
  addIdentityKey(out, row.yesoneSku);
  addIdentityKey(out, row.sku);
  addIdentityKey(out, row.modelid);
  addIdentityKey(out, row.modelId);
  addIdentityKey(out, row.modelNo);
  addIdentityKey(out, row.modelApprovalNo);
  return out;
}

function identityKeysOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const x of left) {
    if (right.has(x)) return true;
    if (x.length < 4) continue;
    for (const y of right) {
      if (y.length < 4) continue;
      if (x.startsWith(y) || y.startsWith(x)) return true;
    }
  }
  return false;
}

export function pasBankMatchesProduct(bank: PasBankDoc, product: Product): boolean {
  const bankKeys = identityKeys(bank);
  if (bankKeys.size === 0) return true;
  return identityKeysOverlap(
    bankKeys,
    identityKeys({
      id: product.id,
      yesoneSku: product.yesoneSku,
      modelid: product.modelid,
      modelNo: product.modelNo,
      modelApprovalNo: product.modelApprovalNo,
    }),
  );
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

function statusKey(status: string): string {
  return status.trim().toLowerCase();
}

function summarizeRows(rows: ProductSerialRow[]): ProductSerialBankSummary {
  let available = 0;
  let used = 0;
  let cancelled = 0;
  for (const row of rows) {
    const status = statusKey(row.status);
    if (status === 'used') used += 1;
    else if (status === 'cancelled' || status === 'replaced') cancelled += 1;
    else available += 1;
  }
  return { rows, qty: rows.length, available, used, cancelled };
}

function pasRowFromSnap(
  id: string,
  data: PasBankDoc,
  product: Product,
): ProductSerialRow | null {
  if (!pasBankMatchesProduct(data, product)) return null;
  const serial = String(data.serialNumber || id).trim();
  if (!serial) return null;
  return {
    id,
    serial,
    status: String(data.status || 'available'),
    pool: 'pas',
    invoiceNo: data.invoiceNo,
  };
}

async function queryPasBank(product: Product): Promise<ProductSerialRow[]> {
  const col = collection(db, PAS_SERIAL_BANK_COLLECTION);
  const listed = await getDocs(col);
  const byId = new Map<string, ProductSerialRow>();
  for (const docSnap of listed.docs) {
    const row = pasRowFromSnap(docSnap.id, (docSnap.data() || {}) as PasBankDoc, product);
    if (row) byId.set(row.id, row);
  }
  return [...byId.values()].sort(serialSortKey);
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
    const rows = productUsesPasSerials(product)
      ? await queryPasBank(product)
      : await queryGasAllotments(product);
    return summarizeRows(rows);
  } catch (err) {
    if (firebaseDenied(err)) {
      throw new Error('Serial bank is blocked. Super admin must deploy Firestore rules.');
    }
    throw err instanceof Error ? err : new Error('Could not load serial numbers.');
  }
}
