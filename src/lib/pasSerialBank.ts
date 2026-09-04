import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import type { Product, SiteCalibration } from '../types';

export const PAS_SERIAL_BANK_COLLECTION = 'pasSerialBank';

export type PasBankDoc = {
  serialNumber?: string;
  status?: string;
  productId?: string;
  productName?: string;
  yesoneSku?: string;
  modelid?: string;
  modelNo?: string;
  usedRecordId?: string;
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

export function pasBankMatchesProduct(bank: PasBankDoc, product: Product): boolean {
  if (bank.productId && bank.productId === product.id) return true;
  if (norm(bank.yesoneSku) && norm(bank.yesoneSku) === norm(product.yesoneSku)) return true;
  if (norm(bank.modelid) && norm(bank.modelid) === norm(product.modelid)) return true;
  if (norm(bank.modelNo) && norm(bank.modelNo) === norm(product.modelNo)) return true;
  return !bank.productId && !norm(bank.yesoneSku) && !norm(bank.modelid) && !norm(bank.modelNo);
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
