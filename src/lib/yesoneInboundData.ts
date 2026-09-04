export type YesoneSerialAllotment = {
  id: string;
  serialNumber: string;
  rcId: string;
  rcCode: string;
  rcCompanyName: string;
  productId: string;
  productName: string;
  modelNo: string;
  sku: string;
  status: string;
  allottedAt: string;
  previousSerialNumber: string;
  updatedAt: string;
  invoiceNo: string;
};

export type YesoneInboundEventRow = {
  id: string;
  at: string;
  ok: boolean;
  count: number;
  results: { event?: string; id?: string; ok?: boolean; error?: string }[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

/** Qty like 1130/306/119 is Allotted sold, not a serial. Real serials have a letter (G0001, Y10315). */
export function looksLikeYesoneSerial(value: unknown): boolean {
  const serial = text(value);
  return Boolean(serial) && /[A-Za-z]/.test(serial);
}

export function yesoneSerialFromDoc(id: string, data: unknown): YesoneSerialAllotment {
  const row = asRecord(data);
  return {
    id,
    serialNumber: text(row.serialNumber) || id,
    rcId: text(row.rcId),
    rcCode: text(row.rcCode),
    rcCompanyName: text(row.rcCompanyName),
    productId: text(row.productId),
    productName: text(row.productName),
    modelNo: text(row.modelNo),
    sku: text(row.sku),
    status: text(row.status) || 'allotted',
    allottedAt: text(row.allottedAt) || text(row.updatedAt),
    previousSerialNumber: text(row.previousSerialNumber),
    updatedAt: text(row.updatedAt),
    invoiceNo: text(row.invoiceNo) || text(row.allotmentId),
  };
}

export function yesoneInboundEventFromDoc(id: string, data: unknown): YesoneInboundEventRow {
  const row = asRecord(data);
  const results = Array.isArray(row.results)
    ? row.results.map(item => {
      const result = asRecord(item);
      return {
        event: text(result.event) || undefined,
        id: text(result.id) || undefined,
        ok: result.ok === true,
        error: text(result.error) || undefined,
      };
    })
    : [];
  return {
    id,
    at: text(row.at),
    ok: row.ok === true,
    count: Number(row.count) || results.length,
    results,
  };
}

export function uniqueSerials(values: unknown): string[] {
  const out = new Set<string>();
  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const serial = text(value);
      if (looksLikeYesoneSerial(serial)) out.add(serial);
      return;
    }
    const row = asRecord(value);
    const serial = text(row.serialNumber) || text(row.serial);
    if (looksLikeYesoneSerial(serial)) out.add(serial);
  };
  push(values);
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function parseSerialParts(value: string): { prefix: string; width: number; n: bigint } | null {
  const match = value.trim().match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], width: match[2].length, n: BigInt(match[2]) };
}

export function expandSerialRange(from: string, to: string, max = 8000): string[] {
  const a = parseSerialParts(from);
  const b = parseSerialParts(to);
  if (!a || !b || a.prefix !== b.prefix || b.n < a.n) {
    return [from.trim(), to.trim()].filter(Boolean);
  }
  const width = Math.max(a.width, b.width);
  const out: string[] = [];
  for (let n = a.n; n <= b.n && out.length < max; n += 1n) {
    out.push(`${a.prefix}${n.toString().padStart(width, '0')}`);
  }
  return out;
}

export function parseQuotaInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function unusedSerials(allotted: string[], used: unknown): string[] {
  const usedKeys = new Set(uniqueSerials(used).map(serial => serial.toLowerCase()));
  return uniqueSerials(allotted).filter(serial => !usedKeys.has(serial.toLowerCase()));
}

export type YesonePlainLogRow = {
  id: string;
  at: string;
  ok: boolean;
  event: string;
  detail: string;
  error?: string;
};

export function yesonePlainLogFromUnknown(raw: unknown, fallbackId: string): YesonePlainLogRow | null {
  const row = asRecord(raw);
  const at = text(row.at);
  const event = text(row.event);
  if (!at && !event) return null;
  const error = text(row.error) || undefined;
  return {
    id: text(row.id) || fallbackId,
    at,
    ok: row.ok === true,
    event: event || 'inbound',
    detail: text(row.detail) || error || (row.ok === true ? 'ok' : 'failed'),
    error,
  };
}

export function yesonePlainLogsFromList(raw: unknown): YesonePlainLogRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => yesonePlainLogFromUnknown(item, `log_${index}`))
    .filter((row): row is YesonePlainLogRow => Boolean(row));
}

export function yesonePlainLogsFromEventDoc(id: string, data: unknown): YesonePlainLogRow[] {
  const row = yesoneInboundEventFromDoc(id, data);
  const count = row.count || row.results.length;
  if (row.results.length === 0) {
    return [{
      id,
      at: row.at,
      ok: row.ok,
      event: 'inbound',
      detail: row.ok ? 'ok' : 'failed',
    }];
  }
  if (row.results.length > 8) {
    const failed = row.results.find(item => !item.ok);
    return [{
      id,
      at: row.at,
      ok: row.ok,
      event: row.results[0]?.event || 'inbound',
      detail: `×${count}${failed?.error ? ` · ${failed.error}` : ''}`,
      error: failed?.error,
    }];
  }
  return row.results.map((item, index) => ({
    id: item.id || `${id}_${index}`,
    at: row.at,
    ok: item.ok === true,
    event: item.event || 'inbound',
    detail: [item.id, item.error].filter(Boolean).join(' · ') || (item.ok ? 'ok' : 'failed'),
    error: item.error,
  }));
}

export function yesonePlainLogsFromLast(log: {
  at: string;
  ok: boolean;
  event: string;
  count: number;
  error?: string;
} | null): YesonePlainLogRow[] {
  if (!log) return [];
  return [{
    id: 'last',
    at: log.at,
    ok: log.ok,
    event: log.event,
    detail: log.error || (log.count > 1 ? `×${log.count}` : 'ok'),
    error: log.error,
  }];
}

export function mergeYesonePlainLogs(...lists: YesonePlainLogRow[][]): YesonePlainLogRow[] {
  const map = new Map<string, YesonePlainLogRow>();
  for (const list of lists) {
    for (const row of list) {
      map.set(`${row.at}|${row.event}|${row.id}`, row);
    }
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
}
