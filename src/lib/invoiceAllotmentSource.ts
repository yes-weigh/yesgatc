import { expandDirectSerialInput } from './interweighingDirectSerials.ts';
import { uniqueSerials } from './yesoneInboundData.ts';
import {
  vrAllottedRangeFullyInPool,
  vrAllottedRangeSerials,
} from './vrAllotted.ts';

export const INVOICE_ALLOT_FROM_RC_QUOTA = 'rcQuota' as const;
export const INVOICE_ALLOT_FROM_INTERWEIGHING = 'interweighingDirect' as const;

export type InvoiceAllotFrom =
  | typeof INVOICE_ALLOT_FROM_RC_QUOTA
  | typeof INVOICE_ALLOT_FROM_INTERWEIGHING;

export const INVOICE_ALLOT_FROM_LABEL: Record<InvoiceAllotFrom, string> = {
  rcQuota: 'Deduct from RC quota',
  interweighingDirect: 'Direct from Interweighing',
};

/** Helper under the dropdown — switches immediately with selection. */
export const INVOICE_ALLOT_FROM_HINT: Record<InvoiceAllotFrom, string> = {
  rcQuota: 'Must be unused RC seats.',
  interweighingDirect: 'Direct Interweighing — does not deduct RC quota.',
};

export const INVOICE_ALLOT_RANGE_ERROR: Record<InvoiceAllotFrom, string> = {
  rcQuota: 'Must be unused RC seats.',
  interweighingDirect: 'Enter a serial start and end.',
};

export const INVOICE_ALLOT_FROM_OPTIONS: Array<{
  value: InvoiceAllotFrom;
  label: string;
}> = [
  {
    value: INVOICE_ALLOT_FROM_RC_QUOTA,
    label: INVOICE_ALLOT_FROM_LABEL.rcQuota,
  },
  {
    value: INVOICE_ALLOT_FROM_INTERWEIGHING,
    label: INVOICE_ALLOT_FROM_LABEL.interweighingDirect,
  },
];

export type InvoiceAllotmentRangeResult = {
  ok: boolean;
  qty: number;
  serials: string[];
  error: string | null;
};

export function isInvoiceAllotFrom(value: unknown): value is InvoiceAllotFrom {
  return value === INVOICE_ALLOT_FROM_RC_QUOTA || value === INVOICE_ALLOT_FROM_INTERWEIGHING;
}

/**
 * Deduct from RC quota: inclusive Yesone range must already exist in unused GAS seats.
 * Does not invent serials. Does not write the Interweighing bank.
 */
export function validateRcQuotaAllotmentRange(input: {
  serialStart: string;
  serialEnd: string;
  unusedRcSerials: readonly string[];
}): InvoiceAllotmentRangeResult {
  const start = input.serialStart.trim();
  const serials = vrAllottedRangeSerials(input.serialStart, input.serialEnd);
  const qty = serials.length;
  if (!start) {
    return { ok: false, qty: 0, serials: [], error: null };
  }
  if (!vrAllottedRangeFullyInPool(input.serialStart, input.serialEnd, input.unusedRcSerials)) {
    return {
      ok: false,
      qty,
      serials,
      error: INVOICE_ALLOT_RANGE_ERROR.rcQuota,
    };
  }
  return { ok: true, qty, serials, error: null };
}

/**
 * Direct from Interweighing: expand start–end (or list). No RC unused / Yesone / Vr Allotted check.
 */
export function validateInterweighingDirectAllotmentRange(input: {
  serialStart: string;
  serialEnd: string;
  listText?: string;
}): InvoiceAllotmentRangeResult {
  const start = input.serialStart.trim();
  const listed = (input.listText || '').trim();
  const serials = expandDirectSerialInput({
    serialStart: input.serialStart,
    serialEnd: input.serialEnd,
    listText: input.listText,
  });
  const qty = serials.length;
  if (!start && !listed) {
    return { ok: false, qty: 0, serials: [], error: null };
  }
  if (qty === 0) {
    return {
      ok: false,
      qty: 0,
      serials: [],
      error: INVOICE_ALLOT_RANGE_ERROR.interweighingDirect,
    };
  }
  return { ok: true, qty, serials, error: null };
}

/** Switch only. Each branch is its own validator — Direct never sees the RC pool. */
export function validateInvoiceAllotmentRange(input: {
  allotFrom: InvoiceAllotFrom;
  serialStart: string;
  serialEnd: string;
  listText?: string;
  unusedRcSerials: readonly string[];
}): InvoiceAllotmentRangeResult {
  if (input.allotFrom === INVOICE_ALLOT_FROM_INTERWEIGHING) {
    return validateInterweighingDirectAllotmentRange({
      serialStart: input.serialStart,
      serialEnd: input.serialEnd,
      listText: input.listText,
    });
  }
  return validateRcQuotaAllotmentRange({
    serialStart: input.serialStart,
    serialEnd: input.serialEnd,
    unusedRcSerials: input.unusedRcSerials,
  });
}

/**
 * RC save overlays reserved / Vr Allotted. Direct save does not touch reserved seats.
 */
export function reservedSerialsAfterInvoiceAllotFrom(input: {
  allotFrom: InvoiceAllotFrom;
  reservedSerials: readonly string[];
  serialStart: string;
  serialEnd: string;
}): string[] {
  if (input.allotFrom === INVOICE_ALLOT_FROM_INTERWEIGHING) {
    return uniqueSerials(input.reservedSerials);
  }
  return uniqueSerials([
    ...input.reservedSerials,
    ...vrAllottedRangeSerials(input.serialStart, input.serialEnd),
  ]);
}
