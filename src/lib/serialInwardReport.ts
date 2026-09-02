import type { YesoneSerialAllotment } from './yesoneInboundData';
import { expandSerialRange, uniqueSerials } from './yesoneInboundData';

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
  return (
    text(rec.invoiceNo)
    || text(rec.invoiceNumber)
    || text(rec.invoiceId)
    || text(rec.allotmentId)
    || text(invoice.no)
    || text(invoice.number)
    || text(invoice.id)
    || text(invoice.invoiceNo)
    || (typeof rec.invoice === 'string' || typeof rec.invoice === 'number' ? text(rec.invoice) : '')
    || text(rec.id)
  );
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
  return (
    name.includes('allot')
    || name.includes('allocat')
    || name.includes('serial')
    || name.includes('created')
    || name.includes('new')
  );
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

type DetailRow = { serial: string; rcCode: string; rcCompanyName: string; rcId: string };

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
        const rc = asRecord(row.rc);
        const fromDetail = rcFromDetails(details, from, to);
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
          rcId: text(row.rcId) || text(rc.id) || text(rc.uid) || fromDetail?.rcId || '',
          rcCode:
            text(row.rcCode)
            || text(rc.rcCode)
            || text(rc.code)
            || fromDetail?.rcCode
            || '',
          rcCompanyName:
            text(row.rcCompanyName)
            || text(row.rcName)
            || text(rc.name)
            || text(rc.companyName)
            || fromDetail?.rcCompanyName
            || '',
        });
      }
      continue;
    }

    const invoiceNo = readInvoiceNoFromPayload(root);
    const from = text(root.from) || text(asRecord(root.series).from);
    const to = text(root.to) || text(asRecord(root.series).to);
    if (invoiceNo && from && to) {
      const fromDetail = rcFromDetails(details, from, to);
      pushBatch(out, {
        id: `evt_${event.id}_${invoiceNo}_${from}`,
        invoiceNo,
        at,
        serialStart: from,
        serialEnd: to,
        totalQty: Number(root.qty) || expandSerialRange(from, to).length,
        rcId: text(root.rcId) || fromDetail?.rcId || '',
        rcCode: text(root.rcCode) || fromDetail?.rcCode || '',
        rcCompanyName:
          text(root.rcCompanyName) || text(root.rcName) || fromDetail?.rcCompanyName || '',
      });
    }
  }

  // Dedupe identical invoice+range (keep latest at).
  const byKey = new Map<string, SerialInwardBatch>();
  for (const row of out) {
    const key = `${row.invoiceNo}|${row.serialStart}|${row.serialEnd}|${normalizeInwardRcCode(row.rcCode)}`;
    const prev = byKey.get(key);
    if (!prev || (row.at || '') >= (prev.at || '')) byKey.set(key, row);
  }
  return [...byKey.values()];
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

/** Merge webhook event rows with persisted batch docs (webhook wins when same key). */
export function mergeWebhookInwardBatches(parts: {
  fromEvents: SerialInwardBatch[];
  stored: SerialInwardBatch[];
}): SerialInwardBatch[] {
  const byKey = new Map<string, SerialInwardBatch>();
  const push = (row: SerialInwardBatch) => {
    if (!row.invoiceNo?.trim() || !row.serialStart || !row.serialEnd) return;
    const key = `${row.invoiceNo}|${row.serialStart}|${row.serialEnd}|${normalizeInwardRcCode(row.rcCode)}|${row.rcId}`;
    const prev = byKey.get(key);
    if (!prev || (row.at || '') >= (prev.at || '')) byKey.set(key, row);
  };
  for (const row of parts.stored) push(row);
  for (const row of parts.fromEvents) push(row);
  return [...byKey.values()];
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
