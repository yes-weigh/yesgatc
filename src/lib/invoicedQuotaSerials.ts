import { expandSerialRange, uniqueSerials, type YesoneSerialAllotment } from './yesoneInboundData';
import {
  filterInwardBatchesForRc,
  inwardBatchesFromInboundEvents,
  type SerialInwardBatch,
} from './serialInwardReport';

/** Expand invoiced inward batches → serial set. */
export function serialsFromInwardBatches(batches: SerialInwardBatch[]): string[] {
  const out: string[] = [];
  for (const row of batches) {
    if (!row.invoiceNo?.trim()) continue;
    if (!row.serialStart || !row.serialEnd) continue;
    out.push(...expandSerialRange(row.serialStart, row.serialEnd));
  }
  return uniqueSerials(out);
}

export function invoicedSerialsFromAllotments(allotments: YesoneSerialAllotment[]): string[] {
  return uniqueSerials(
    allotments
      .filter(row => row.invoiceNo?.trim() && row.status !== 'cancelled' && row.status !== 'replaced')
      .map(row => row.serialNumber),
  );
}

export function invoicedSerialsFromEvents(
  events: { id: string; at?: string; payload?: unknown }[],
  scope: { rcId?: string; rcCode?: string },
): string[] {
  const batches = filterInwardBatchesForRc(inwardBatchesFromInboundEvents(events), scope);
  return serialsFromInwardBatches(batches);
}

/** Serials covered by reserved invoice numbers (RC-only / hidden from VCT). */
export function serialsForReservedInvoices(
  batches: SerialInwardBatch[],
  reservedInvoices: string[],
): string[] {
  const wanted = new Set(
    reservedInvoices.map(item => String(item || '').trim().toUpperCase()).filter(Boolean),
  );
  if (wanted.size === 0) return [];
  return serialsFromInwardBatches(
    batches.filter(row => wanted.has(String(row.invoiceNo || '').trim().toUpperCase())),
  );
}
