import {
  DEFAULT_RC_FEES_STRUCTURE,
  productMaximumCapacityKg,
  verificationFeeWithGst,
} from './rcProfileFields';
import {
  istDateKey,
  rvGstFeeRatesForDateKey,
} from './rvGstBillRates';
import { parseAdditionalFeeInput } from './verificationDocaCharges';
import type { Product, RcFeesStructure, SiteCalibration } from '../types';

export type RvCustomerFeeLine = {
  capacityKg: number;
  gatcFee: number;
  gst: number;
  rcFees: number;
  additionalFee: number;
  discount: number;
  netRcFees: number;
  total: number;
};

export function parseDiscountFeeInput(value: string): number {
  return parseAdditionalFeeInput(value);
}

/** RV customer package is always the IN SITU tier (Setting → RV fees). */
export function rvInSituPackageTotalInr(
  fees: RcFeesStructure | null | undefined,
  capacityKg: number,
): number {
  const structure = fees ?? DEFAULT_RC_FEES_STRUCTURE;
  const tier = capacityKg <= 20 ? structure.tierUpto20Kg : structure.tierUpto150Kg;
  return Math.round(tier.inSitu);
}

/** Interweighing / GATC verification fee — same dated rates as the GST bill. */
export function rvGatcVerificationFeeInr(capacityKg: number, rateIso?: string | null): number {
  const dateKey = istDateKey(rateIso) ?? istDateKey(new Date().toISOString());
  const rates = dateKey
    ? rvGstFeeRatesForDateKey(dateKey)
    : rvGstFeeRatesForDateKey('9999-12-31');
  return capacityKg <= 20 ? rates.upto20Kg : rates.above20Kg;
}

export function computeRvCustomerFeeLine(input: {
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null | undefined;
  fees?: RcFeesStructure | null;
  additionalFee?: string | number;
  discountFee?: string | number;
  rateIso?: string | null;
}): RvCustomerFeeLine | null {
  const capacityKg = productMaximumCapacityKg(input.product);
  if (capacityKg == null) return null;

  const gatcFee = rvGatcVerificationFeeInr(capacityKg, input.rateIso);
  const { gst } = verificationFeeWithGst(gatcFee);
  const packageTotal = rvInSituPackageTotalInr(input.fees, capacityKg);
  const rcFees = Math.max(0, packageTotal - gatcFee - gst);
  const additionalFee =
    typeof input.additionalFee === 'number'
      ? Math.max(0, Math.round(input.additionalFee))
      : parseAdditionalFeeInput(input.additionalFee ?? '0');
  const discount =
    typeof input.discountFee === 'number'
      ? Math.max(0, Math.round(input.discountFee))
      : parseDiscountFeeInput(input.discountFee ?? '0');
  const netRcFees = Math.max(0, rcFees + additionalFee - discount);
  const total = Math.max(0, packageTotal + additionalFee - discount);

  return {
    capacityKg,
    gatcFee,
    gst,
    rcFees,
    additionalFee,
    discount,
    netRcFees,
    total,
  };
}

export function productCapacityFromRecord(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement' | 'productId'>,
  products: Product[],
): Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null {
  const listed = record.productId
    ? products.find(product => product.id === record.productId) ?? null
    : null;
  if (listed) return listed;
  if (record.maximumCapacity == null || !Number.isFinite(record.maximumCapacity)) return null;
  return {
    maximumCapacity: record.maximumCapacity,
    unitOfMeasurement: record.unitOfMeasurement ?? 'kg',
  };
}

/** Same RV last-page Total the agent sees (package + additional − discount). */
export function computeRvCustomerFeeLineForRecord(
  record: Pick<
    SiteCalibration,
    | 'maximumCapacity'
    | 'unitOfMeasurement'
    | 'productId'
    | 'additionalFee'
    | 'discountFee'
    | 'certifiedAt'
    | 'submittedAt'
    | 'approvedAt'
    | 'createdAt'
  >,
  products: Product[],
  fees?: RcFeesStructure | null,
): RvCustomerFeeLine | null {
  return computeRvCustomerFeeLine({
    product: productCapacityFromRecord(record, products),
    fees,
    additionalFee: record.additionalFee ?? 0,
    discountFee: record.discountFee ?? 0,
    rateIso: record.certifiedAt || record.submittedAt || record.approvedAt || record.createdAt,
  });
}

export function sumRvCustomerFeeLines(lines: RvCustomerFeeLine[]): RvCustomerFeeLine | null {
  if (lines.length === 0) return null;
  return lines.reduce(
    (acc, line) => ({
      capacityKg: acc.capacityKg,
      gatcFee: acc.gatcFee + line.gatcFee,
      gst: acc.gst + line.gst,
      rcFees: acc.rcFees + line.rcFees,
      additionalFee: acc.additionalFee + line.additionalFee,
      discount: acc.discount + line.discount,
      netRcFees: acc.netRcFees + line.netRcFees,
      total: acc.total + line.total,
    }),
    {
      capacityKg: lines[0]!.capacityKg,
      gatcFee: 0,
      gst: 0,
      rcFees: 0,
      additionalFee: 0,
      discount: 0,
      netRcFees: 0,
      total: 0,
    },
  );
}
