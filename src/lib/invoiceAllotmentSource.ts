import { isGasStickerSerial, isPasStickerSerial } from './pasSerialBankMatch.ts';
import { expandDirectSerialInput } from './interweighingDirectSerials.ts';
import { uniqueSerials } from './yesoneInboundData.ts';
import {
  isInvoiceProductType,
  serialsFullyInPool,
  vrAllottedAssignmentSerials,
  vrAllottedRangeFullyInPool,
  type InvoiceProductType,
} from './vrAllotted.ts';

export { isInvoiceProductType };

export const INVOICE_PRODUCT_TYPE_GAS = 'gas' as const;
export const INVOICE_PRODUCT_TYPE_PAS = 'pas' as const;

export type { InvoiceProductType };

export const INVOICE_PRODUCT_TYPE_LABEL: Record<InvoiceProductType, string> = {
  gas: 'GAS',
  pas: 'PAS',
};

export const INVOICE_PRODUCT_TYPE_OPTIONS: Array<{
  value: InvoiceProductType;
  label: string;
}> = [
  { value: INVOICE_PRODUCT_TYPE_GAS, label: INVOICE_PRODUCT_TYPE_LABEL.gas },
  { value: INVOICE_PRODUCT_TYPE_PAS, label: INVOICE_PRODUCT_TYPE_LABEL.pas },
];

export const INVOICE_ALLOT_PAS_ERROR = {
  product: 'Select a PAS product.',
  seats: 'Must be unused PAS seats for this product.',
  gasMix: 'PAS allotment cannot use GAS X/G serials.',
} as const;

export const INVOICE_ALLOT_GAS_ERROR = {
  pasMix: 'GAS allotment cannot use PAS serials.',
} as const;

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

export function resolveInvoiceAllotmentSerials(input: {
  serialStart?: string;
  serialEnd?: string;
  serials?: readonly string[];
  listText?: string;
}): string[] {
  return vrAllottedAssignmentSerials(input);
}

export function invoiceAllotmentConsumesRcGas(input: {
  allotFrom: InvoiceAllotFrom;
  productType?: InvoiceProductType | string;
}): boolean {
  return (
    input.allotFrom === INVOICE_ALLOT_FROM_RC_QUOTA
    && String(input.productType || INVOICE_PRODUCT_TYPE_GAS).trim().toLowerCase() !== 'pas'
  );
}

/**
 * Deduct from RC quota: inclusive Yesone range or explicit list must already exist
 * in unused GAS seats. Does not invent serials. Does not write the Interweighing bank.
 */
export function validateRcQuotaAllotmentRange(input: {
  serialStart: string;
  serialEnd: string;
  listText?: string;
  serials?: readonly string[];
  unusedRcSerials: readonly string[];
}): InvoiceAllotmentRangeResult {
  const serials = resolveInvoiceAllotmentSerials(input);
  const qty = serials.length;
  const start = input.serialStart.trim();
  const listed = (input.listText || '').trim() || (input.serials || []).length > 0;
  if (!start && !listed) {
    return { ok: false, qty: 0, serials: [], error: null };
  }
  if (qty === 0) {
    return { ok: false, qty: 0, serials: [], error: INVOICE_ALLOT_RANGE_ERROR.rcQuota };
  }
  if (serials.some(serial => isPasStickerSerial(serial))) {
    return { ok: false, qty, serials, error: INVOICE_ALLOT_GAS_ERROR.pasMix };
  }
  const inPool = listed
    ? serialsFullyInPool(serials, input.unusedRcSerials)
    : vrAllottedRangeFullyInPool(input.serialStart, input.serialEnd, input.unusedRcSerials);
  if (!inPool) {
    return {
      ok: false,
      qty,
      serials,
      error: INVOICE_ALLOT_RANGE_ERROR.rcQuota,
    };
  }
  return { ok: true, qty, serials, error: null };
}

/** RC + PAS: unused PAS bank for that product only. Never consumes GAS reserved / 150/20/130. */
export function validateRcPasAllotment(input: {
  serialStart: string;
  serialEnd: string;
  listText?: string;
  serials?: readonly string[];
  unusedPasSerials: readonly string[];
  hasProduct: boolean;
}): InvoiceAllotmentRangeResult {
  if (!input.hasProduct) {
    return { ok: false, qty: 0, serials: [], error: INVOICE_ALLOT_PAS_ERROR.product };
  }
  const serials = resolveInvoiceAllotmentSerials(input);
  const qty = serials.length;
  const start = input.serialStart.trim();
  const listed = (input.listText || '').trim() || (input.serials || []).length > 0;
  if (!start && !listed) {
    return { ok: false, qty: 0, serials: [], error: null };
  }
  if (qty === 0) {
    return { ok: false, qty: 0, serials: [], error: INVOICE_ALLOT_PAS_ERROR.seats };
  }
  if (serials.some(serial => isGasStickerSerial(serial))) {
    return { ok: false, qty, serials, error: INVOICE_ALLOT_PAS_ERROR.gasMix };
  }
  if (!serialsFullyInPool(serials, input.unusedPasSerials)) {
    return { ok: false, qty, serials, error: INVOICE_ALLOT_PAS_ERROR.seats };
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
  serials?: readonly string[];
  productType?: InvoiceProductType | string;
  hasProduct?: boolean;
}): InvoiceAllotmentRangeResult {
  const productType = String(input.productType || INVOICE_PRODUCT_TYPE_GAS).trim().toLowerCase();
  if (productType === INVOICE_PRODUCT_TYPE_PAS && !input.hasProduct) {
    return { ok: false, qty: 0, serials: [], error: INVOICE_ALLOT_PAS_ERROR.product };
  }
  const start = input.serialStart.trim();
  const listed = (input.listText || '').trim() || (input.serials || []).length > 0;
  const serials = listed
    ? resolveInvoiceAllotmentSerials(input)
    : expandDirectSerialInput({
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
  if (productType === INVOICE_PRODUCT_TYPE_PAS && serials.some(serial => isGasStickerSerial(serial))) {
    return { ok: false, qty, serials, error: INVOICE_ALLOT_PAS_ERROR.gasMix };
  }
  if (productType !== INVOICE_PRODUCT_TYPE_PAS && serials.some(serial => isPasStickerSerial(serial))) {
    return { ok: false, qty, serials, error: INVOICE_ALLOT_GAS_ERROR.pasMix };
  }
  return { ok: true, qty, serials, error: null };
}

/** Switch only. Each branch is its own validator — Direct never sees the RC pool. */
export function validateInvoiceAllotmentRange(input: {
  allotFrom: InvoiceAllotFrom;
  productType?: InvoiceProductType | string;
  serialStart: string;
  serialEnd: string;
  listText?: string;
  serials?: readonly string[];
  unusedRcSerials: readonly string[];
  unusedPasSerials?: readonly string[];
  hasProduct?: boolean;
}): InvoiceAllotmentRangeResult {
  const productType = String(input.productType || INVOICE_PRODUCT_TYPE_GAS).trim().toLowerCase();
  if (input.allotFrom === INVOICE_ALLOT_FROM_INTERWEIGHING) {
    return validateInterweighingDirectAllotmentRange({
      serialStart: input.serialStart,
      serialEnd: input.serialEnd,
      listText: input.listText,
      serials: input.serials,
      productType,
      hasProduct: input.hasProduct,
    });
  }
  if (productType === INVOICE_PRODUCT_TYPE_PAS) {
    return validateRcPasAllotment({
      serialStart: input.serialStart,
      serialEnd: input.serialEnd,
      listText: input.listText,
      serials: input.serials,
      unusedPasSerials: input.unusedPasSerials || [],
      hasProduct: Boolean(input.hasProduct),
    });
  }
  return validateRcQuotaAllotmentRange({
    serialStart: input.serialStart,
    serialEnd: input.serialEnd,
    listText: input.listText,
    serials: input.serials,
    unusedRcSerials: input.unusedRcSerials,
  });
}

/**
 * RC + GAS overlays reserved / Vr Allotted. PAS and Direct leave GAS reserved unchanged.
 */
export function reservedSerialsAfterInvoiceAllotFrom(input: {
  allotFrom: InvoiceAllotFrom;
  productType?: InvoiceProductType | string;
  reservedSerials: readonly string[];
  serialStart: string;
  serialEnd: string;
  listText?: string;
  serials?: readonly string[];
}): string[] {
  if (!invoiceAllotmentConsumesRcGas(input)) {
    return uniqueSerials(input.reservedSerials);
  }
  return uniqueSerials([
    ...input.reservedSerials,
    ...resolveInvoiceAllotmentSerials(input).filter(serial => !isPasStickerSerial(serial)),
  ]);
}
