import {
  contractorFeeForDate,
  type ContractorFeeScheduleEntry,
} from './contractorFeeSettings';
import { formatRcFeeAmount, productMaximumCapacityKg } from './rcProfileFields';
import type { Product, SiteCalibration } from '../types';

/** Admin collected / Interweighing / contractor split (INR) by maximum capacity. */
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
  handling: number;
  rcShare: number;
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

function adminShare(tier: StampCapacityTier): StampRevenueShare {
  const base = tier === 'upto20' ? STAMP_SHARE_UPTO_20_KG : STAMP_SHARE_ABOVE_20_KG;
  return {
    tier,
    ...base,
    handling: 0,
    rcShare: base.collected - base.contractor,
  };
}

export function stampRevenueShare(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement' | 'productId'>,
  productsById: Map<string, Product>,
): StampRevenueShare | null {
  const kg = recordCapacityKg(record, productsById);
  if (kg == null) return null;
  return adminShare(kg <= 20 ? 'upto20' : 'above20');
}

/** RC pays contractor from dated Setting schedule. Collected stays admin stamp rate. */
export function stampRcRevenueShare(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement' | 'productId'>,
  productsById: Map<string, Product>,
  dateKey: string,
  schedules: ContractorFeeScheduleEntry[],
): StampRevenueShare | null {
  const admin = stampRevenueShare(record, productsById);
  if (!admin) return null;
  const fee = contractorFeeForDate(schedules, dateKey);
  const contractor = admin.tier === 'upto20' ? fee.upto20Kg : fee.above20Kg;
  return {
    tier: admin.tier,
    collected: admin.collected,
    interweighing: 0,
    contractor,
    handling: fee.handlingFee,
    rcShare: admin.collected - contractor,
  };
}

export function formatReportInr(amount: number): string {
  return formatRcFeeAmount(amount);
}
