import type { Product } from '../types';
import { expandSerialRange } from './yesoneInboundData.ts';

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
  bankQty?: number;
  bankLinked?: number;
  bankUnused?: number;
  serialFrom?: string;
  serialTo?: string;
  usedRecordId?: string;
};

export type PasBankUsage = {
  qty?: number | null;
  linked?: number | null;
  unused?: number | null;
  from?: string;
  to?: string;
};

export type ProductSerialRow = {
  id: string;
  serial: string;
  status: string;
  pool: 'pas' | 'gas';
  invoiceNo?: string;
  bankQty?: number;
  bankLinked?: number;
  bankUnused?: number;
  serialFrom?: string;
  serialTo?: string;
};

export type ProductSerialBankSummary = {
  rows: ProductSerialRow[];
  qty: number;
  available: number;
  used: number;
  cancelled: number;
};

function norm(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function compactIdent(value?: string | null): string {
  return norm(value).replace(/[^a-z0-9]/g, '');
}

function pasMatchKeys(row: {
  id?: string;
  productId?: string;
  yesoneSku?: string;
  sku?: string;
  modelid?: string;
  modelId?: string;
}): { sku: string; productId: string; modelid: string } {
  return {
    sku: compactIdent(row.yesoneSku || row.sku),
    productId: compactIdent(row.productId || row.id),
    modelid: compactIdent(row.modelid || row.modelId),
  };
}

function parseSerialParts(value: string): { prefix: string; width: number; n: bigint } | null {
  const match = value.trim().match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], width: match[2].length, n: BigInt(match[2]) };
}

/** 5 kg / 10 kg kitchen PAS stickers share one tank. Never ATM or other PAS. */
const KITCHEN_PAS_POOL = 'ks-5-10';
const KITCHEN_PAS_SKUS = new Set(['ks05bay', 'ks10bay']);
const KITCHEN_PAS_MODELS = new Set(['ysk5', 'ysk10']);

export function pasSharedPoolKey(row: {
  yesoneSku?: string | null;
  sku?: string | null;
  modelid?: string | null;
  modelId?: string | null;
}): string | null {
  const sku = compactIdent(row.yesoneSku || row.sku);
  const model = compactIdent(row.modelid || row.modelId);
  if (KITCHEN_PAS_SKUS.has(sku) || KITCHEN_PAS_MODELS.has(model)) return KITCHEN_PAS_POOL;
  return null;
}

export const KITCHEN_PAS_META_IDS = ['KS10BAY', 'KS05BAY'] as const;

function pickSerialBound(
  current: string | undefined,
  candidate: string | undefined,
  want: 'min' | 'max',
): string | undefined {
  const next = String(candidate || '').trim();
  if (!next) return current;
  if (!current) return next;
  const a = parseSerialParts(current);
  const b = parseSerialParts(next);
  if (!a || !b || a.prefix !== b.prefix) return current;
  if (want === 'min') return b.n < a.n ? next : current;
  return b.n > a.n ? next : current;
}

export function sumPasBankUsage(parts: readonly PasBankUsage[]): PasBankUsage | null {
  const rows = parts.filter(part =>
    finiteCount(part.qty) != null
    || finiteCount(part.linked) != null
    || finiteCount(part.unused) != null
    || part.from
    || part.to,
  );
  if (rows.length === 0) return null;
  let qty = 0;
  let linked = 0;
  let unused = 0;
  let hasQty = false;
  let hasLinked = false;
  let hasUnused = false;
  let from: string | undefined;
  let to: string | undefined;
  for (const part of rows) {
    const q = finiteCount(part.qty);
    const l = finiteCount(part.linked);
    const u = finiteCount(part.unused);
    if (q != null) {
      qty += q;
      hasQty = true;
    }
    if (l != null) {
      linked += l;
      hasLinked = true;
    }
    if (u != null) {
      unused += u;
      hasUnused = true;
    }
    from = pickSerialBound(from, part.from, 'min');
    to = pickSerialBound(to, part.to, 'max');
  }
  return {
    qty: hasQty ? qty : null,
    linked: hasLinked ? linked : null,
    unused: hasUnused ? unused : null,
    from,
    to,
  };
}

/** PAS stickers (Yesone number bank). Never G/X GAS seats. */
export function isPasStickerSerial(serial: string): boolean {
  return serial.trim().toUpperCase().startsWith('YJ');
}

/** GAS allotted stickers. YJ is PAS even if it also starts with a letter. */
export function isGasStickerSerial(serial: string): boolean {
  const key = serial.trim().toUpperCase();
  if (!key || isPasStickerSerial(key)) return false;
  return key.startsWith('G') || key.startsWith('X');
}

export function serialInInclusiveRange(serial: string, from?: string, to?: string): boolean {
  const s = parseSerialParts(serial);
  const a = parseSerialParts(from || '');
  const b = parseSerialParts(to || '');
  if (!s || !a || !b || s.prefix !== a.prefix || a.prefix !== b.prefix) return false;
  return s.n >= a.n && s.n <= b.n;
}

/** Exact sku / productId / modelid, plus 5 kg / 10 kg kitchen PAS pool. Never fail-open. Never prefix. Never approval/name. */
export function pasBankMatchesProduct(bank: PasBankDoc, product: Product): boolean {
  const bankPool = pasSharedPoolKey(bank);
  const productPool = pasSharedPoolKey({
    yesoneSku: product.yesoneSku,
    sku: product.yesoneSku,
    modelid: product.modelid,
  });
  if (bankPool && productPool && bankPool === productPool) return true;
  const bankKeys = pasMatchKeys(bank);
  const productKeys = pasMatchKeys({
    id: product.id,
    yesoneSku: product.yesoneSku,
    modelid: product.modelid,
  });
  if (bankKeys.sku && productKeys.sku) return bankKeys.sku === productKeys.sku;
  if (bankKeys.productId && productKeys.productId && bankKeys.productId === productKeys.productId) {
    return true;
  }
  if (bankKeys.sku || productKeys.sku) return false;
  if (bankKeys.modelid && productKeys.modelid && bankKeys.modelid === productKeys.modelid) {
    return true;
  }
  return false;
}

export function pasBankListedForProduct(
  bank: PasBankDoc,
  product: Product,
  range?: { from?: string; to?: string } | null,
): boolean {
  if (pasBankMatchesProduct(bank, product)) return true;
  if (!range?.from || !range.to) return false;
  const bankSku = compactIdent(bank.yesoneSku || bank.sku);
  const productSku = compactIdent(product.yesoneSku);
  if (bankSku && productSku && bankSku !== productSku) return false;
  if (bankSku) return false;
  const serial = String(bank.serialNumber || '').trim();
  return Boolean(serial) && serialInInclusiveRange(serial, range.from, range.to);
}

function finiteCount(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function usageFromSerialRows(rows: readonly ProductSerialRow[]): PasBankUsage | null {
  const hit = rows.find(row =>
    row.bankLinked != null || row.bankUnused != null || row.bankQty != null || row.serialFrom || row.serialTo,
  );
  if (!hit) return null;
  return {
    qty: finiteCount(hit.bankQty),
    linked: finiteCount(hit.bankLinked),
    unused: finiteCount(hit.bankUnused),
    from: hit.serialFrom,
    to: hit.serialTo,
  };
}

export function mergePasBankUsage(
  primary?: PasBankUsage | null,
  fallback?: PasBankUsage | null,
): PasBankUsage | null {
  if (!primary && !fallback) return null;
  return {
    qty: finiteCount(primary?.qty) ?? finiteCount(fallback?.qty),
    linked: finiteCount(primary?.linked) ?? finiteCount(fallback?.linked),
    unused: finiteCount(primary?.unused) ?? finiteCount(fallback?.unused),
    from: primary?.from || fallback?.from,
    to: primary?.to || fallback?.to,
  };
}

function statusKey(status: string): string {
  return status.trim().toLowerCase();
}

export function summarizeSerialRows(rows: ProductSerialRow[]): ProductSerialBankSummary {
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

export function mergePasBankCounts(
  rows: ProductSerialRow[],
  usage?: PasBankUsage | null,
): ProductSerialBankSummary {
  const fromRows = summarizeSerialRows(rows);
  const qty = fromRows.qty > 0 ? fromRows.qty : finiteCount(usage?.qty) ?? 0;
  const linked = finiteCount(usage?.linked);
  const unused = finiteCount(usage?.unused);
  const used = Math.max(fromRows.used, linked ?? 0);
  const extraLocal = Math.max(0, fromRows.used - (linked ?? fromRows.used));
  const available = unused != null
    ? Math.max(0, unused - extraLocal)
    : Math.max(0, qty - used - fromRows.cancelled);
  return { rows, qty, available, used, cancelled: fromRows.cancelled };
}

export type PasBankVerifyOptions = {
  /** RV types an existing (often already used) PAS serial. OV must still be unused. */
  allowUsed?: boolean;
};

export function pasBankOptionsForJob(verificationType: string | undefined | null): PasBankVerifyOptions {
  return { allowUsed: verificationType === 'RV' };
}

export function pasBankStatusError(serial: string, status: string, allowUsed = false): string | null {
  const key = status.trim().toLowerCase();
  if (!key || key === 'available' || key === 'allotted') return null;
  if (key === 'used') return allowUsed ? null : `Serial ${serial} is already used.`;
  return `Serial ${serial} is not available.`;
}

/** Sync PAS bank decision. Unknown serial never proceeds. */
export function interpretPasBankLookup(
  serial: string,
  data: PasBankDoc | null | undefined,
  product: Product,
  options?: PasBankVerifyOptions,
): string | null {
  const trimmed = serial.trim();
  if (!trimmed) return 'Serial number is required.';
  if (!data) return `Serial ${trimmed} is not in the PAS number bank.`;
  const statusError = pasBankStatusError(trimmed, String(data.status || ''), Boolean(options?.allowUsed));
  if (statusError) return statusError;
  if (!pasBankMatchesProduct(data, product)) {
    return `Serial ${trimmed} is not allotted to this PAS product.`;
  }
  return null;
}

/** Yesone PAS meta from/to — YJ only. Never expand a G/X unused range into the block list. */
export function pasSerialsFromMetaRanges(
  metas: ReadonlyArray<{ from?: string | null; to?: string | null }>,
): string[] {
  const out: string[] = [];
  for (const meta of metas) {
    const from = String(meta.from || '').trim();
    const to = String(meta.to || '').trim();
    if (!from || !to) continue;
    if (isGasStickerSerial(from) || isGasStickerSerial(to)) continue;
    for (const serial of expandSerialRange(from, to)) {
      if (isPasStickerSerial(serial)) out.push(serial);
    }
  }
  return [...new Set(out)];
}

export function mergePasBlockedSerials(
  ...groups: Array<Iterable<string> | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const serial of group) {
      const trimmed = String(serial || '').trim();
      if (!trimmed) continue;
      const key = trimmed.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
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
  if (isGasStickerSerial(row.serialNumber)) return false;
  if (isPasStickerSerial(row.serialNumber)) return true;
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

export function finitePasCount(value?: number | null): number | null {
  return finiteCount(value);
}
