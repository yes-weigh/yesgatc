import { isPasStickerSerial } from './pasSerialBankMatch.ts';
import { expandSerialRange } from './yesoneInboundData.ts';
import type { InterweighingDirectBatch, SiteCalibration } from '../types.ts';

export const INTERWEIGHING_DIRECT_SOURCE = 'interweighingDirect' as const;
export const RC_YESONE_SERIAL_SOURCE = 'rcYesone' as const;

export type SerialBankSource = typeof INTERWEIGHING_DIRECT_SOURCE | typeof RC_YESONE_SERIAL_SOURCE;

export type InterweighingDirectSeats = {
  allotted: string[];
  used: string[];
  unused: string[];
  allottedQty: number;
  usedQty: number;
  balanceQty: number;
};

function serialKey(serial: string): string {
  return serial.trim().toUpperCase();
}

/** Unique trimmed serials. No Yesone letter gate — this bank is not `uniqueSerials`. */
export function uniqueDirectSerials(values: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const serial = String(value).trim();
    if (!serial) return;
    const key = serialKey(serial);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(serial);
  };
  push(values);
  return out;
}

export function parseDirectSerialList(raw: string): string[] {
  return uniqueDirectSerials(raw.split(/[\s,;]+/));
}

export function expandDirectSerialInput(input: {
  serialStart: string;
  serialEnd: string;
  listText?: string;
}): string[] {
  const listed = parseDirectSerialList(input.listText || '');
  if (listed.length > 0) return listed;
  const from = input.serialStart.trim();
  const to = (input.serialEnd || input.serialStart).trim();
  if (!from) return [];
  return uniqueDirectSerials(expandSerialRange(from, to));
}

export function isInterweighingDirectSource(value: unknown): boolean {
  return String(value || '').trim() === INTERWEIGHING_DIRECT_SOURCE;
}

export function isInterweighingDirectRecord(
  record: Pick<SiteCalibration, 'serialSource'>,
): boolean {
  return isInterweighingDirectSource(record.serialSource);
}

function directJobCountsAsUsed(record: SiteCalibration): boolean {
  if (record.verificationType === 'RV') return false;
  if (record.certificateVoidedAt?.trim()) return false;
  const status = String(record.status || '').trim().toLowerCase();
  if (status === 'rejected') return false;
  return true;
}

export function computeInterweighingDirectSeats(input: {
  allotted: unknown;
  records: SiteCalibration[];
}): InterweighingDirectSeats {
  const allotted = uniqueDirectSerials(input.allotted).filter(serial => !isPasStickerSerial(serial));
  const allottedKeys = new Set(allotted.map(serialKey));
  const usedKeys = new Set<string>();
  for (const record of input.records) {
    if (!directJobCountsAsUsed(record)) continue;
    const serial = String(record.serialNumber || '').trim();
    if (!serial) continue;
    const key = serialKey(serial);
    if (allottedKeys.has(key) || isInterweighingDirectRecord(record)) {
      if (allottedKeys.has(key)) usedKeys.add(key);
    }
  }
  const used = allotted.filter(serial => usedKeys.has(serialKey(serial)));
  const unused = allotted.filter(serial => !usedKeys.has(serialKey(serial)));
  return {
    allotted,
    used,
    unused,
    allottedQty: allotted.length,
    usedQty: used.length,
    balanceQty: unused.length,
  };
}

export function nextInterweighingDirectSerials(
  prev: unknown,
  addSerials: string[],
): string[] {
  return uniqueDirectSerials([...(Array.isArray(prev) ? prev : []), ...addSerials]);
}

/** Yesone used count ignores tagged direct jobs. */
export function yesoneOvRecordsForQuota(records: SiteCalibration[]): SiteCalibration[] {
  return records.filter(record => !isInterweighingDirectRecord(record));
}

export function normalizeInterweighingDirectBatches(raw: unknown): InterweighingDirectBatch[] {
  if (!Array.isArray(raw)) return [];
  const out: InterweighingDirectBatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const listed = uniqueDirectSerials(row.serials);
    const serialStart = String(row.serialStart || listed[0] || '').trim();
    if (!serialStart && listed.length === 0) continue;
    const serialEnd = String(row.serialEnd || serialStart || listed[listed.length - 1] || '').trim() || serialStart;
    const qtyRaw = Number(row.qty);
    const qty =
      Number.isFinite(qtyRaw) && qtyRaw > 0
        ? qtyRaw
        : listed.length > 0
          ? listed.length
          : expandDirectSerialInput({ serialStart, serialEnd }).length;
    const productType = String(row.productType || '').trim().toLowerCase() === 'pas' ? 'pas' : undefined;
    const batch: InterweighingDirectBatch = {
      serialStart: serialStart || listed[0],
      serialEnd: serialEnd || listed[listed.length - 1] || serialStart || listed[0],
      qty,
      allottedAt: String(row.allottedAt || '').trim(),
      allottedByUid: String(row.allottedByUid || '').trim(),
    };
    if (listed.length > 0) batch.serials = listed;
    if (productType) {
      batch.productType = productType;
      const productId = String(row.productId || '').trim();
      const productName = String(row.productName || '').trim();
      const modelid = String(row.modelid || row.modelId || '').trim();
      const yesoneSku = String(row.yesoneSku || row.sku || '').trim();
      if (productId) batch.productId = productId;
      if (productName) batch.productName = productName;
      if (modelid) batch.modelid = modelid;
      if (yesoneSku) batch.yesoneSku = yesoneSku;
    }
    const invoiceNo = String(row.invoiceNo || '').trim();
    if (invoiceNo) batch.invoiceNo = invoiceNo;
    const invoiceUrl = String(row.invoiceUrl || '').trim();
    const invoicePath = String(row.invoicePath || '').trim();
    const invoiceName = String(row.invoiceName || '').trim();
    const invoiceContentType = String(row.invoiceContentType || '').trim();
    if (invoiceUrl) batch.invoiceUrl = invoiceUrl;
    if (invoicePath) batch.invoicePath = invoicePath;
    if (invoiceName) batch.invoiceName = invoiceName;
    if (invoiceContentType) batch.invoiceContentType = invoiceContentType;
    out.push(batch);
  }
  return out;
}
