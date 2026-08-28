export type YesoneSerialAllotment = {
  id: string;
  serialNumber: string;
  rcId: string;
  rcCode: string;
  rcCompanyName: string;
  productName: string;
  status: string;
  allottedAt: string;
  previousSerialNumber: string;
  updatedAt: string;
};

export type YesoneInboundEventRow = {
  id: string;
  at: string;
  ok: boolean;
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

export function yesoneSerialFromDoc(id: string, data: unknown): YesoneSerialAllotment {
  const row = asRecord(data);
  return {
    id,
    serialNumber: text(row.serialNumber) || id,
    rcId: text(row.rcId),
    rcCode: text(row.rcCode),
    rcCompanyName: text(row.rcCompanyName),
    productName: text(row.productName),
    status: text(row.status) || 'allotted',
    allottedAt: text(row.allottedAt),
    previousSerialNumber: text(row.previousSerialNumber),
    updatedAt: text(row.updatedAt),
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
      if (serial) out.add(serial);
      return;
    }
    const row = asRecord(value);
    const serial = text(row.serialNumber) || text(row.serial);
    if (serial) out.add(serial);
  };
  push(values);
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
  if (row.results.length === 0) {
    return [{
      id,
      at: row.at,
      ok: row.ok,
      event: 'inbound',
      detail: row.ok ? 'ok' : 'failed',
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
