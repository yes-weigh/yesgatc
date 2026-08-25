import { maximumCapacityKgFromRecord } from './zohoRvSubmit';
import type { SiteCalibration, StoredVerificationGstBill } from '../types';

/** Inclusive last IST calendar day of the original GST invoice rates. */
export const RV_GST_FEE_CUTOVER_DATE = '2026-08-18';

export const RV_GST_FEE_THROUGH_CUTOVER = {
  upto20Kg: 150,
  above20Kg: 250,
} as const;

export const RV_GST_FEE_AFTER_CUTOVER = {
  upto20Kg: 200,
  above20Kg: 350,
} as const;

export type RvGstFeeRates = {
  upto20Kg: number;
  above20Kg: number;
};

export type { StoredVerificationGstBill };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function istDateKey(iso?: string | null): string | null {
  if (!iso?.trim()) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function rvGstBillRateIso(
  record: Partial<Pick<SiteCalibration, 'certifiedAt' | 'submittedAt' | 'approvedAt' | 'createdAt'>>,
): string | undefined {
  return record.certifiedAt || record.submittedAt || record.approvedAt || record.createdAt;
}

export function rvGstFeeRatesForDateKey(dateKey: string): RvGstFeeRates {
  return dateKey <= RV_GST_FEE_CUTOVER_DATE ? RV_GST_FEE_THROUGH_CUTOVER : RV_GST_FEE_AFTER_CUTOVER;
}

function roundInrPaise(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function splitKeralaGst(taxableValue: number): { cgst: number; sgst: number; total: number } {
  const cgst = roundInrPaise(taxableValue * 0.09);
  const sgst = roundInrPaise(taxableValue * 0.09);
  return { cgst, sgst, total: roundInrPaise(taxableValue + cgst + sgst) };
}

export function isStoredGstBill(value: unknown): value is StoredVerificationGstBill {
  if (!value || typeof value !== 'object') return false;
  const bill = value as StoredVerificationGstBill;
  return (
    Number.isFinite(bill.taxableValue)
    && bill.taxableValue > 0
    && Number.isFinite(bill.cgstAmount)
    && Number.isFinite(bill.sgstAmount)
    && Number.isFinite(bill.totalAmount)
    && bill.totalAmount > 0
    && DATE_KEY.test(bill.rateDate ?? '')
  );
}

export function gstBillsMatch(
  a: StoredVerificationGstBill | null | undefined,
  b: StoredVerificationGstBill | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.taxableValue === b.taxableValue
    && a.cgstAmount === b.cgstAmount
    && a.sgstAmount === b.sgstAmount
    && a.totalAmount === b.totalAmount
    && a.feeUpto20KgInr === b.feeUpto20KgInr
    && a.feeAbove20KgInr === b.feeAbove20KgInr
    && a.rateDate === b.rateDate
  );
}

export function computeStoredGstBill(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement'> &
    Partial<Pick<SiteCalibration, 'certifiedAt' | 'submittedAt' | 'approvedAt' | 'createdAt'>>,
  storedAt = new Date().toISOString(),
): StoredVerificationGstBill | null {
  const capacityKg = maximumCapacityKgFromRecord(record);
  if (capacityKg == null) return null;

  const rateDate = istDateKey(rvGstBillRateIso(record));
  if (!rateDate) return null;

  const rates = rvGstFeeRatesForDateKey(rateDate);
  const taxableValue = capacityKg <= 20 ? rates.upto20Kg : rates.above20Kg;
  const { cgst, sgst, total } = splitKeralaGst(taxableValue);

  return {
    taxableValue,
    cgstAmount: cgst,
    sgstAmount: sgst,
    totalAmount: total,
    feeUpto20KgInr: rates.upto20Kg,
    feeAbove20KgInr: rates.above20Kg,
    rateDate,
    storedAt,
  };
}
