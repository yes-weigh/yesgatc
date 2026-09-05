import type { Product } from '../types.ts';
import {
  ovSerialChoicesForRow,
  remainingSerialsForProduct,
  type OvQuotaAllotment,
} from './ovQuotaGate.ts';

export type SerialEntryMode = 'gas-select' | 'pas-type';

/** GAS = pick unused allotted seat. PAS = type, then verify that product’s bank. */
export function serialEntryMode(product: Product | null | undefined): SerialEntryMode {
  return Boolean(product?.pasPreAllotted) ? 'pas-type' : 'gas-select';
}

export function productAllotmentKey(
  product: Product | null | undefined,
  fallback?: { productId?: string; productName?: string },
): { productId?: string; productName?: string; sku?: string; modelNo?: string } {
  return {
    productId: product?.id || fallback?.productId,
    productName: product?.name || fallback?.productName,
    sku: product?.yesoneSku,
    modelNo: product?.modelNo,
  };
}

function poolKey(row: Pick<OvQuotaAllotment, 'pool'>): string {
  return String(row.pool || '').trim().toLowerCase();
}

function gasAllotmentRows(allotments: OvQuotaAllotment[] | undefined): OvQuotaAllotment[] | undefined {
  if (!allotments) return allotments;
  return allotments.filter(row => poolKey(row) !== 'pas');
}

function pasPoolSerialKeys(allotments: OvQuotaAllotment[] | undefined): Set<string> {
  const keys = new Set<string>();
  for (const row of allotments || []) {
    if (poolKey(row) !== 'pas') continue;
    const serial = row.serialNumber.trim().toUpperCase();
    if (serial) keys.add(serial);
  }
  return keys;
}

/** Unused GAS seats for this product. Never the PAS bank. */
export function gasAllottedChoices(options: {
  remaining: string[];
  allotments?: OvQuotaAllotment[];
  heldSerials?: string[];
  otherTaken?: string[];
  product?: Product | null;
  fallbackProduct?: { productId?: string; productName?: string };
}): string[] {
  const pasBlocked = pasPoolSerialKeys(options.allotments);
  const remaining = remainingSerialsForProduct(
    options.remaining.filter(serial => !pasBlocked.has(serial.trim().toUpperCase())),
    gasAllotmentRows(options.allotments),
    productAllotmentKey(options.product, options.fallbackProduct),
  );
  return ovSerialChoicesForRow(
    '',
    remaining,
    options.heldSerials ?? [],
    options.otherTaken ?? [],
  );
}

export function serialInChoiceList(serial: string, choices: readonly string[]): boolean {
  const key = serial.trim().toUpperCase();
  if (!key) return false;
  return choices.some(item => item.trim().toUpperCase() === key);
}

/**
 * Sync pool check. PAS bank lookup stays async (`verifyPasSerialInBank`).
 * OV GAS must be an unused allotted seat for that product — no invented serials.
 * RV GAS types the existing serial (already used; not a new unused seat).
 */
export function validateSerialForProductPool(options: {
  mode: SerialEntryMode;
  verificationType: string;
  serial: string;
  gasChoices: readonly string[];
}): string | null {
  const serial = options.serial.trim();
  if (!serial) return 'Serial number is required.';
  if (options.mode === 'pas-type') return null;
  if (options.verificationType !== 'OV') return null;
  if (serialInChoiceList(serial, options.gasChoices)) return null;
  if (options.gasChoices.length === 0) {
    return 'No unused allotted serials for this product.';
  }
  return `Serial ${serial} is not in the allotted list for this product.`;
}

/** OCR may fill a field. GAS only accepts a seat already on the allotted list. */
export function applyOcrSerialToPool(options: {
  mode: SerialEntryMode;
  ocrSerial: string;
  allottedMatch: string | null;
  gasChoices: readonly string[];
}): string | null {
  if (options.mode === 'gas-select') {
    const candidates = [options.allottedMatch, options.ocrSerial]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      const hit = options.gasChoices.find(item => item.trim().toUpperCase() === candidate.toUpperCase());
      if (hit) return hit;
    }
    return null;
  }
  const typed = options.ocrSerial.trim();
  return typed || null;
}
