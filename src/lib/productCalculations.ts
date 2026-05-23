/** Derived scale fields from manual Maximum Capacity (kg) and Verification Scale Interval e (g). */

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
