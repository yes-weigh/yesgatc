import type { YesoneSerialAllotment } from './yesoneInboundData';
import { expandSerialRange, looksLikeYesoneSerial, uniqueSerials } from './yesoneInboundData';

export const SERIAL_INWARD_BATCHES_COLLECTION = 'serialInwardBatches';

export type SerialInwardBatch = {
  id: string;
  invoiceNo: string;
  at: string;
  serialStart: string;
  serialEnd: string;
  totalQty: number;
  rcId: string;
  rcCode: string;
  rcCompanyName: string;
};

type DetailRow = { serial: string; rcCode: string; rcCompanyName: string; rcId: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeInwardRcCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
}

function readInvoiceNoFromPayload(rec: Record<string, unknown>): string {
  const invoice = asRecord(rec.invoice);
  const links = Array.isArray(rec.invoiceLinks) ? rec.invoiceLinks : [];
  const link0 = asRecord(links[0]);
  return (
    text(rec.invoiceNo)
    || text(rec.invoiceNumber)
    || text(rec.invoiceId)
    || text(rec.allotmentId)
    || text(invoice.no)
    || text(invoice.number)
    || text(invoice.invoiceNumber)
    || text(invoice.invoiceNo)
    || text(invoice.id)
    || text(link0.invoiceNumber)
    || text(link0.invoiceNo)
    || text(link0.invoiceId)
    || (typeof rec.invoice === 'string' || typeof rec.invoice === 'number' ? text(rec.invoice) : '')
    || text(rec.id)
  );
}

function rcMetaFromPayload(
  row: Record<string, unknown>,
  root: Record<string, unknown>,
  detail?: DetailRow | null,
): { rcId: string; rcCode: string; rcCompanyName: string } {
  const rowRc = asRecord(row.rc);
  const rootRc = asRecord(root.rc);
  const links = Array.isArray(row.invoiceLinks) ? row.invoiceLinks : [];
  const link0 = asRecord(links[0]);
  return {
    rcId:
      text(row.rcId)
      || text(rowRc.id)
      || text(rowRc.uid)
      || text(root.rcId)
      || text(rootRc.id)
      || text(rootRc.uid)
      || text(detail?.rcId)
      || '',
    rcCode:
      text(row.rcCode)
      || text(rowRc.rcCode)
      || text(rowRc.code)
      || text(link0.rcCode)
      || text(root.rcCode)
      || text(rootRc.rcCode)
      || text(rootRc.code)
      || text(detail?.rcCode)
      || '',
    rcCompanyName:
      text(row.rcCompanyName)
      || text(row.rcName)
      || text(rowRc.name)
      || text(rowRc.companyName)
      || text(link0.rcName)
      || text(link0.dealerName)
      || text(root.rcCompanyName)
      || text(root.rcName)
      || text(rootRc.name)
      || text(rootRc.companyName)
      || text(rootRc.rcName)
      || text(detail?.rcCompanyName)
      || '',
  };
}

function parseSerialParts(value: string): { prefix: string; n: bigint } | null {
  const match = value.trim().match(/^(.*?)(\d+)$/);
  if (!match) return null;
  try {
    return { prefix: match[1], n: BigInt(match[2]) };
  } catch {
    return null;
  }
}

function serialInRange(serial: string, from: string, to: string): boolean {
  const s = parseSerialParts(serial);
  const a = parseSerialParts(from);
  const b = parseSerialParts(to);
  if (!s || !a || !b || s.prefix !== a.prefix) return false;
  return s.n >= a.n && s.n <= b.n;
}

function isCancelEvent(root: Record<string, unknown>): boolean {
  const name = text(root.event || root.type || root.kind || root.action).toLowerCase();
  return name.includes('cancel');
}

function isAllotEvent(root: Record<string, unknown>): boolean {
  const name = text(root.event || root.type || root.kind || root.action).toLowerCase();
  if (!name) return true;
  if (name.includes('cancel')) return false;
  if (name.includes('quota')) return false;
  // Ignore serial.updated / patch noise — only fresh allotments drive inward rows.
  if (name.includes('update') && !name.includes('allot')) return false;
  return (
    name.includes('allot')
    || name.includes('allocat')
    || name.includes('created')
    || name.includes('new')
  );
}

function isValidInwardSerialBound(value: string): boolean {
  return looksLikeYesoneSerial(value);
}

/** One invoice + RC → one row (prefer valid range, then earlier allot time). */
export function collapseInwardBatchesByInvoice(rows: SerialInwardBatch[]): SerialInwardBatch[] {
  const byKey = new Map<string, SerialInwardBatch>();
  for (const row of rows) {
    const invoiceNo = row.invoiceNo?.trim();
    if (!invoiceNo) continue;
    if (!isValidInwardSerialBound(row.serialStart) || !isValidInwardSerialBound(row.serialEnd)) continue;
    const key = `${invoiceNo}|${normalizeInwardRcCode(row.rcCode)}|${row.rcId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevSpan = expandSerialRange(prev.serialStart, prev.serialEnd).length;
    const nextSpan = expandSerialRange(row.serialStart, row.serialEnd).length;
    const prevFit = prev.totalQty > 0 && prev.totalQty === prevSpan ? 1 : 0;
    const nextFit = row.totalQty > 0 && row.totalQty === nextSpan ? 1 : 0;
    if (nextFit !== prevFit) {
      if (nextFit > prevFit) byKey.set(key, row);
      continue;
    }
    // Same invoice: keep earliest allotment (corrupt later updates lose).
    if ((row.at || '') < (prev.at || '')) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function serialInwardBatchFromDoc(id: string, data: unknown): SerialInwardBatch {
  const row = asRecord(data);
  return {
    id,
    invoiceNo: text(row.invoiceNo),
    at: text(row.at) || text(row.createdAt),
    serialStart: text(row.serialStart),
    serialEnd: text(row.serialEnd),
    totalQty: Number(row.totalQty) || 0,
    rcId: text(row.rcId),
    rcCode: text(row.rcCode),
    rcCompanyName: text(row.rcCompanyName),
  };
}

function detailRowsFromPayload(root: Record<string, unknown>): DetailRow[] {
  const details = root.generatedSerialDetails || root.rcAllottedSerialDetails;
  if (!Array.isArray(details)) return [];
  const out: DetailRow[] = [];
  for (const item of details) {
    const row = asRecord(item);
    const serial = text(row.serial) || text(row.serialNumber) || text(row.serialNo);
    if (!serial) continue;
    out.push({
      serial,
      rcCode: text(row.rcCode) || text(asRecord(row.rc).rcCode),
      rcCompanyName: text(row.rcName) || text(row.rcCompanyName) || text(asRecord(row.rc).name),
      rcId: text(row.rcId) || text(row.rcUid) || text(asRecord(row.rc).id),
    });
  }
  return out;
}

function rcFromDetails(details: DetailRow[], from: string, to: string): DetailRow | null {
  const hit = details.find(d => serialInRange(d.serial, from, to));
  return hit || null;
}

function pushBatch(
  out: SerialInwardBatch[],
  row: Omit<SerialInwardBatch, 'id'> & { id?: string },
): void {
  if (!row.invoiceNo || !row.serialStart || !row.serialEnd) return;
  const qty = row.totalQty > 0 ? row.totalQty : expandSerialRange(row.serialStart, row.serialEnd).length;
  if (qty <= 0) return;
  out.push({
    id: row.id || `in_${row.invoiceNo}_${row.serialStart}_${row.serialEnd}`,
    invoiceNo: row.invoiceNo,
    at: row.at,
    serialStart: row.serialStart,
    serialEnd: row.serialEnd,
    totalQty: qty,
    rcId: row.rcId,
    rcCode: row.rcCode,
    rcCompanyName: row.rcCompanyName,
  });
}

/** Audit rows from YesOne webhook payloads — invoice, at, start/end, qty, RC. */
export function inwardBatchesFromInboundEvents(
  events: { id: string; at?: string; payload?: unknown }[],
): SerialInwardBatch[] {
  const out: SerialInwardBatch[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    const data = asRecord(payload.data);
    const root = { ...payload, ...data };
    if (isCancelEvent(root)) continue;
    if (!isAllotEvent(root) && !Array.isArray(root.allotments)) continue;

    const at = text(event.at) || text(root.at) || new Date().toISOString();
    const details = detailRowsFromPayload(root);
    const allotments = Array.isArray(root.allotments) ? root.allotments : [];

    if (allotments.length > 0) {
      for (const raw of allotments) {
        const row = asRecord(raw);
        const invoiceNo = readInvoiceNoFromPayload(row) || readInvoiceNoFromPayload(root);
        const from = text(row.from) || text(asRecord(row.series).from);
        const to = text(row.to) || text(asRecord(row.series).to);
        if (!invoiceNo || !from || !to) continue;
        if (!isValidInwardSerialBound(from) || !isValidInwardSerialBound(to)) continue;
        const fromDetail = rcFromDetails(details, from, to);
        const rcMeta = rcMetaFromPayload(row, root, fromDetail);
        const listed = Array.isArray(row.serialNumbers)
          ? uniqueSerials(row.serialNumbers)
          : Array.isArray(row.serials)
            ? uniqueSerials(row.serials)
            : [];
        const qty =
          Number(row.qty)
          || Number(row.count)
          || (listed.length > 0 ? listed.length : 0)
          || expandSerialRange(from, to).length;
        pushBatch(out, {
          id: `evt_${event.id}_${invoiceNo}_${from}`,
          invoiceNo,
          at,
          serialStart: from,
          serialEnd: to,
          totalQty: qty,
          rcId: rcMeta.rcId,
          rcCode: rcMeta.rcCode,
          rcCompanyName: rcMeta.rcCompanyName,
        });
      }
      continue;
    }

    const invoiceNo = readInvoiceNoFromPayload(root);
    const from = text(root.from) || text(asRecord(root.series).from);
    const to = text(root.to) || text(asRecord(root.series).to);
    if (invoiceNo && from && to) {
      if (!isValidInwardSerialBound(from) || !isValidInwardSerialBound(to)) {
        // skip corrupt bounds like startNumber "Numbers"
      } else {
      const fromDetail = rcFromDetails(details, from, to);
      const rcMeta = rcMetaFromPayload(root, root, fromDetail);
      pushBatch(out, {
        id: `evt_${event.id}_${invoiceNo}_${from}`,
        invoiceNo,
        at,
        serialStart: from,
        serialEnd: to,
        totalQty: Number(root.qty) || expandSerialRange(from, to).length,
        rcId: rcMeta.rcId,
        rcCode: rcMeta.rcCode,
        rcCompanyName: rcMeta.rcCompanyName,
      });
      }
    }
  }

  // Dedupe identical invoice+range, then one row per invoice+RC.
  const byKey = new Map<string, SerialInwardBatch>();
  for (const row of out) {
    const key = `${row.invoiceNo}|${row.serialStart}|${row.serialEnd}|${normalizeInwardRcCode(row.rcCode)}`;
    const prev = byKey.get(key);
    if (!prev || (row.at || '') >= (prev.at || '')) byKey.set(key, row);
  }
  return collapseInwardBatchesByInvoice([...byKey.values()]);
}

export function filterInwardBatchesForRc(
  rows: SerialInwardBatch[],
  scope?: { rcId?: string; rcCode?: string } | null,
): SerialInwardBatch[] {
  if (!scope?.rcId && !scope?.rcCode) return rows;
  const code = normalizeInwardRcCode(scope.rcCode || '');
  return rows.filter(row => {
    if (scope.rcId && row.rcId && row.rcId === scope.rcId) return true;
    if (code && normalizeInwardRcCode(row.rcCode) === code) return true;
    return false;
  });
}

export function formatInwardDate(at: string): string {
  if (!at) return '—';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export function formatInwardTime(at: string): string {
  if (!at) return '—';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

export function inwardMonthKey(at: string): string {
  if (!at) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  return year && month ? `${year}-${month}` : '';
}

function serialRangeOverlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const a0 = parseSerialParts(aStart);
  const a1 = parseSerialParts(aEnd);
  const b0 = parseSerialParts(bStart);
  const b1 = parseSerialParts(bEnd);
  if (!a0 || !a1 || !b0 || !b1) {
    return (
      aStart.toUpperCase() === bStart.toUpperCase()
      || aEnd.toUpperCase() === bEnd.toUpperCase()
      || aStart.toUpperCase() === bEnd.toUpperCase()
      || aEnd.toUpperCase() === bStart.toUpperCase()
    );
  }
  if (a0.prefix !== b0.prefix || a0.prefix !== a1.prefix || b0.prefix !== b1.prefix) return false;
  return a0.n <= b1.n && b0.n <= a1.n;
}

function sameInwardRc(a: SerialInwardBatch, b: SerialInwardBatch): boolean {
  if (a.rcId && b.rcId && a.rcId === b.rcId) return true;
  const ca = normalizeInwardRcCode(a.rcCode);
  const cb = normalizeInwardRcCode(b.rcCode);
  return Boolean(ca && cb && ca === cb);
}

/** Merge webhook event rows with persisted batch docs (webhook wins when same key). */
export function mergeWebhookInwardBatches(parts: {
  fromEvents: SerialInwardBatch[];
  stored: SerialInwardBatch[];
}): SerialInwardBatch[] {
  const byKey = new Map<string, SerialInwardBatch>();
  const push = (row: SerialInwardBatch) => {
    if (!row.serialStart || !row.serialEnd) return;
    const invoice = row.invoiceNo?.trim() || '_';
    const key = `${invoice}|${row.serialStart}|${row.serialEnd}|${normalizeInwardRcCode(row.rcCode)}|${row.rcId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      return;
    }
    // Prefer row that has a real invoice number.
    const prevInv = Boolean(prev.invoiceNo?.trim());
    const nextInv = Boolean(row.invoiceNo?.trim());
    if (nextInv && !prevInv) {
      byKey.set(key, row);
      return;
    }
    if (prevInv && !nextInv) return;
    if ((row.at || '') >= (prev.at || '')) byKey.set(key, row);
  };
  for (const row of parts.stored) push(row);
  for (const row of parts.fromEvents) push(row);

  const merged = [...byKey.values()];
  const invoiced = merged.filter(row => row.invoiceNo?.trim());
  // Drop synthetic (no invoice) ranges that overlap an invoiced batch for same RC.
  return collapseInwardBatchesByInvoice(
    merged.filter(row => {
      if (row.invoiceNo?.trim()) return true;
      return !invoiced.some(
        inv =>
          sameInwardRc(row, inv)
          && serialRangeOverlaps(row.serialStart, row.serialEnd, inv.serialStart, inv.serialEnd),
      );
    }),
  );
}

/** Fallback: contiguous allotted serials → inward rows (RC when webhook events locked). */
export function syntheticInwardBatchesFromAllotments(
  allotments: YesoneSerialAllotment[],
  options?: { requireInvoice?: boolean },
): SerialInwardBatch[] {
  const requireInvoice = options?.requireInvoice === true;
  const byKey = new Map<string, YesoneSerialAllotment[]>();
  for (const row of allotments) {
    if (!row.serialNumber) continue;
    const invoiceNo = text(row.invoiceNo);
    if (requireInvoice && !invoiceNo) continue;
    const day = (row.allottedAt || row.updatedAt || '').slice(0, 10) || 'unknown';
    const key = `${row.rcId}|${day}|${invoiceNo || '_'}`;
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }

  const out: SerialInwardBatch[] = [];
  for (const [key, rows] of byKey) {
    const serials = uniqueSerials(rows.map(r => r.serialNumber));
    if (serials.length === 0) continue;
    const parts = key.split('|');
    const rcId = parts[0] || '';
    const day = parts[1] || '';
    const invoiceNo = parts.slice(2).join('|');
    const invoiceLabel = invoiceNo === '_' ? '' : invoiceNo;
    const at =
      rows.map(r => r.allottedAt || r.updatedAt).filter(Boolean).sort()[0]
      || `${day}T00:00:00.000Z`;
    let rangeStart = 0;
    const flush = (endIndex: number) => {
      const slice = serials.slice(rangeStart, endIndex + 1);
      out.push({
        id: `syn_${invoiceLabel || 'na'}_${slice[0]}_${slice[slice.length - 1]}`,
        invoiceNo: invoiceLabel,
        at,
        serialStart: slice[0],
        serialEnd: slice[slice.length - 1],
        totalQty: slice.length,
        rcId: rows[0]?.rcId || rcId,
        rcCode: rows[0]?.rcCode || '',
        rcCompanyName: rows[0]?.rcCompanyName || '',
      });
    };
    for (let i = 1; i < serials.length; i += 1) {
      if (!areConsecutiveSerials(serials[i - 1], serials[i])) {
        flush(i - 1);
        rangeStart = i;
      }
    }
    flush(serials.length - 1);
  }
  return out;
}

function areConsecutiveSerials(a: string, b: string): boolean {
  const ma = a.match(/^(.*?)(\d+)$/);
  const mb = b.match(/^(.*?)(\d+)$/);
  if (!ma || !mb || ma[1] !== mb[1]) return false;
  try {
    return BigInt(mb[2]) - BigInt(ma[2]) === 1n;
  } catch {
    return false;
  }
}
