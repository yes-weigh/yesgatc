import type { Product } from '../types';

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

export function serialInInclusiveRange(serial: string, from?: string, to?: string): boolean {
  const s = parseSerialParts(serial);
  const a = parseSerialParts(from || '');
  const b = parseSerialParts(to || '');
  if (!s || !a || !b || s.prefix !== a.prefix || a.prefix !== b.prefix) return false;
  return s.n >= a.n && s.n <= b.n;
}

/** Exact sku / productId / modelid. Never fail-open. Never prefix. Never approval/name. */
export function pasBankMatchesProduct(bank: PasBankDoc, product: Product): boolean {
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

export function finitePasCount(value?: number | null): number | null {
  return finiteCount(value);
}
