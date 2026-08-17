import { formatRcFeeAmount, productMaximumCapacityKg } from './rcProfileFields';
import type { Product, SiteCalibration } from '../types';

/** Stamping collection and split (INR) by maximum capacity. */
export const STAMP_SHARE_UPTO_20_KG = {
  collected: 200,
  interweighing: 100,
  contractor: 100,
} as const;

export const STAMP_SHARE_ABOVE_20_KG = {
  collected: 350,
  interweighing: 150,
  contractor: 200,
} as const;

export type StampCapacityTier = 'upto20' | 'above20';

export type StampRevenueShare = {
  tier: StampCapacityTier;
  collected: number;
  interweighing: number;
  contractor: number;
};

export function recordCapacityKg(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement' | 'productId'>,
  productsById: Map<string, Product>,
): number | null {
  if (record.maximumCapacity != null && Number.isFinite(record.maximumCapacity)) {
    return productMaximumCapacityKg({
      maximumCapacity: record.maximumCapacity,
      unitOfMeasurement: record.unitOfMeasurement || 'kg',
    });
  }
  const product = productsById.get(record.productId?.trim() || '');
  return productMaximumCapacityKg(product ?? null);
}

export function stampRevenueShare(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement' | 'productId'>,
  productsById: Map<string, Product>,
): StampRevenueShare | null {
  const kg = recordCapacityKg(record, productsById);
  if (kg == null) return null;
  if (kg <= 20) {
    return { tier: 'upto20', ...STAMP_SHARE_UPTO_20_KG };
  }
  return { tier: 'above20', ...STAMP_SHARE_ABOVE_20_KG };
}

export function formatReportInr(amount: number): string {
  return formatRcFeeAmount(amount);
}
