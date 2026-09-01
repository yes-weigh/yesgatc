/** Derived scale fields from manual Maximum Capacity (kg) and Verification Scale Interval e (g). */

import type { Product, SiteCalibration } from '../types';

export const PRODUCT_CALC_TOOLTIPS = {
  minimumCapacity: 'Minimum Capacity (Min) = Verification Scale Interval (e) × 20',
  actualScaleInterval: 'Actual Scale Interval (d) = Verification Scale Interval (e)',
  noOfVerificationIntervals:
    'No. of Verification Intervals (n) = Maximum Capacity (Max) × 1000 ÷ Verification Scale Interval (e)',
} as const;

export interface ProductDerivedValues {
  minimumCapacity: number;
  actualScaleInterval: number;
  noOfVerificationIntervals: number;
}

export function computeProductDerived(
  maximumCapacity: number,
  verificationScaleInterval: number,
): ProductDerivedValues {
  const e = verificationScaleInterval;
  const max = maximumCapacity;
  return {
    minimumCapacity: e * 20,
    actualScaleInterval: e,
    noOfVerificationIntervals: e > 0 ? (max * 1000) / e : 0,
  };
}

export function parseProductNumber(value: string | number | undefined): number {
  if (value === '' || value === undefined || value === null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Display auto-calculated values; blank when inputs are empty. */
export function formatDerivedDisplay(
  value: number,
  hasInputs: boolean,
): string {
  if (!hasInputs) return '';
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

export function formatProductMaximumCapacity(
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'>,
): string {
  if (!product.maximumCapacity) return '—';
  return `${product.maximumCapacity} ${product.unitOfMeasurement || 'kg'}`;
}

export function formatProductScaleInterval(
  product: Pick<Product, 'actualScaleInterval' | 'verificationScaleInterval'>,
): string {
  if (product.actualScaleInterval != null && Number.isFinite(product.actualScaleInterval)) {
    return `${product.actualScaleInterval} g`;
  }
  if (product.verificationScaleInterval) return `${product.verificationScaleInterval} g`;
  return '—';
}

function formatRoundedNumber(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

export function formatProductGramValue(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '—';
  return `${formatRoundedNumber(value)} g`;
}

export function formatProductVerificationInterval(
  product: Pick<Product, 'verificationScaleInterval'>,
): string {
  return formatProductGramValue(product.verificationScaleInterval);
}

export function formatProductMinimumCapacity(product: Product): string {
  if (product.minimumCapacity != null && Number.isFinite(product.minimumCapacity) && product.minimumCapacity > 0) {
    return formatProductGramValue(product.minimumCapacity);
  }
  if (product.maximumCapacity && product.verificationScaleInterval) {
    return formatProductGramValue(
      computeProductDerived(product.maximumCapacity, product.verificationScaleInterval).minimumCapacity,
    );
  }
  return '—';
}

export function formatProductVerificationIntervals(product: Product): string {
  if (
    product.noOfVerificationIntervals != null &&
    Number.isFinite(product.noOfVerificationIntervals) &&
    product.noOfVerificationIntervals > 0
  ) {
    return formatRoundedNumber(product.noOfVerificationIntervals);
  }
  if (product.maximumCapacity && product.verificationScaleInterval) {
    return formatRoundedNumber(
      computeProductDerived(product.maximumCapacity, product.verificationScaleInterval)
        .noOfVerificationIntervals,
    );
  }
  return '—';
}

export function formatProductMpe(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value) || value === 0) return '—';
  return formatRoundedNumber(value);
}

export function formatProductText(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed || '—';
}

/** Max, e, and min — for product pickers on verification flows. */
export function formatProductCapacitySpecs(product: Product): string {
  const specs = product.specifications;
  if (specs && specs.length > 1) {
    const caps = specs
      .map(s => (Number.isFinite(s.maximumCapacity) ? String(s.maximumCapacity) : ''))
      .filter(Boolean);
    if (caps.length > 0) return caps.join(' · ');
  }
  const parts: string[] = [];
  const max = formatProductMaximumCapacity(product);
  if (max !== '—') parts.push(`Max ${max}`);
  const e = formatProductVerificationInterval(product);
  if (e !== '—') parts.push(`e ${e}`);
  const min = formatProductMinimumCapacity(product);
  if (min !== '—') parts.push(`Min ${min}`);
  return parts.join(' · ');
}

/** Short product summary for inline tables and pickers. */
export function formatProductBriefSummary(product: Product | null | undefined): string {
  if (!product) return '';
  const parts: string[] = [];
  if (product.modelid?.trim()) parts.push(product.modelid.trim());
  if (product.typeOfInstrument?.trim()) parts.push(product.typeOfInstrument.trim());
  const capacity = formatProductMaximumCapacity(product);
  if (capacity !== '—') parts.push(capacity);
  const interval = formatProductScaleInterval(product);
  if (interval !== '—') parts.push(`d ${interval}`);
  const mpe = formatProductMpe(product.maximumPermissibleError);
  if (mpe !== '—') parts.push(`MPE ${mpe}`);
  return parts.join(' · ');
}

export function formatVerificationInstrumentFields(
  record: Pick<
    SiteCalibration,
    | 'maximumCapacity'
    | 'minimumCapacity'
    | 'unitOfMeasurement'
    | 'verificationScaleInterval'
    | 'productSpecificationId'
  >,
  product?: Product | null,
): { max: string; min: string; e: string } {
  const specId = record.productSpecificationId?.trim();
  const spec = specId && product?.specifications?.length
    ? product.specifications.find(row => row.id === specId)
    : undefined;
  const maxValue = record.maximumCapacity ?? spec?.maximumCapacity ?? product?.maximumCapacity ?? 0;
  const eValue =
    record.verificationScaleInterval
    ?? spec?.verificationScaleInterval
    ?? product?.verificationScaleInterval;
  const minValue =
    record.minimumCapacity
    ?? spec?.minimumCapacity
    ?? (eValue != null && Number.isFinite(eValue) ? eValue * 20 : undefined)
    ?? product?.minimumCapacity;
  const max = formatProductMaximumCapacity({
    maximumCapacity: maxValue,
    unitOfMeasurement: record.unitOfMeasurement ?? product?.unitOfMeasurement ?? 'kg',
  });
  return { max, min: formatProductGramValue(minValue), e: formatProductGramValue(eValue) };
}
