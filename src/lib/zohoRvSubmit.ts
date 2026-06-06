import { normalizeVerificationStatus } from './verificationRequest';
import { formatRcFeeAmount, normalizeZohoId, verificationFeeWithGst } from './rcProfileFields';
import type { ZohoRvSettings } from './zohoSettings';
import type { JobType, SiteCalibration } from '../types';

export const RV_ZOHO_SUBMIT_BLOCK_MESSAGE =
  'RV cannot be submitted until Super Admin sets your Zoho customer ID on the RC profile.';

export function isZohoRvInvoicingEnabled(settings: Pick<ZohoRvSettings, 'zohoRvInvoicingEnabled'>): boolean {
  return settings.zohoRvInvoicingEnabled !== false;
}

export function rcZohoIdReady(zohoId: string | null | undefined): boolean {
  return normalizeZohoId(zohoId ?? '').length >= 10;
}

export function canViewZohoPushDiagnostics(
  role: string | null | undefined,
): boolean {
  return role === 'super_admin' || role === 'rc_admin' || role === 'vct';
}

export function validateRvZohoSubmitReady(
  verificationType: JobType | '',
  rcZohoId: string | null | undefined,
  settings: Pick<ZohoRvSettings, 'zohoRvInvoicingEnabled'>,
): string | null {
  if (verificationType !== 'RV') return null;
  if (!isZohoRvInvoicingEnabled(settings)) return null;
  if (rcZohoIdReady(rcZohoId)) return null;
  return RV_ZOHO_SUBMIT_BLOCK_MESSAGE;
}

export function maximumCapacityKgFromRecord(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement'>,
): number | null {
  if (record.maximumCapacity == null || !Number.isFinite(record.maximumCapacity)) {
    return null;
  }
  if (record.unitOfMeasurement === 'g') {
    return record.maximumCapacity / 1000;
  }
  return record.maximumCapacity;
}

export type ZohoPushStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export function resolveZohoPushStatus(
  record: Pick<
    SiteCalibration,
    'verificationType' | 'status' | 'zohoPushStatus' | 'zohoInvoiceId' | 'resubmittedFromId'
  >,
): ZohoPushStatus | null {
  if (record.verificationType !== 'RV') return null;
  if (record.status !== 'submitted' && record.status !== 'approved' && record.status !== 'certified') {
    return null;
  }
  if (record.resubmittedFromId?.trim()) return 'skipped';
  if (record.zohoPushStatus === 'sent' || record.zohoInvoiceId) return 'sent';
  if (record.zohoPushStatus === 'failed') return 'failed';
  if (record.zohoPushStatus === 'skipped') return 'skipped';
  return 'pending';
}

export function zohoPushStatusLabel(status: ZohoPushStatus): string {
  switch (status) {
    case 'sent':
      return 'Invoice sent';
    case 'failed':
      return 'Invoice failed';
    case 'skipped':
      return 'Invoice skipped (resubmit)';
    default:
      return 'Invoice pending';
  }
}

/** True once an RV has left the draft stage (includes legacy rows missing `status`). */
export function isRvVerificationSubmittedOrBeyond(
  record: Pick<SiteCalibration, 'status' | 'certificateNumber' | 'submittedAt' | 'approvedAt' | 'certifiedAt'>,
): boolean {
  if (normalizeVerificationStatus(record) !== 'draft') return true;
  return Boolean(
    record.certificateNumber?.trim()
    || record.submittedAt?.trim()
    || record.approvedAt?.trim()
    || record.certifiedAt?.trim(),
  );
}

/** Submitted RV records that still need a Zoho invoice (e.g. before automation existed). */
export function isRvZohoInvoiceOutstanding(
  record: Pick<
    SiteCalibration,
    | 'verificationType'
    | 'status'
    | 'certificateNumber'
    | 'submittedAt'
    | 'approvedAt'
    | 'certifiedAt'
    | 'zohoInvoiceId'
    | 'zohoPushStatus'
    | 'resubmittedFromId'
  > | null
  | undefined,
): boolean {
  if (!record || record.verificationType !== 'RV') return false;
  if (record.resubmittedFromId?.trim()) return false;
  if (record.zohoInvoiceId?.trim()) return false;
  if (record.zohoPushStatus === 'sent') return false;
  return isRvVerificationSubmittedOrBeyond(record);
}

/** Zoho Books RV line-item rates (pre-GST) — must match configured Zoho products. */
export const ZOHO_RV_PRODUCT_BASE_UPTO_20_KG = 150;
export const ZOHO_RV_PRODUCT_BASE_ABOVE_20_KG = 250;

export type RvZohoInvoiceSummary = {
  baseInr: number;
  totalInr: number;
  tierLabel: string;
};

export function zohoRvProductBaseInr(capacityKg: number): number {
  return capacityKg <= 20 ? ZOHO_RV_PRODUCT_BASE_UPTO_20_KG : ZOHO_RV_PRODUCT_BASE_ABOVE_20_KG;
}

/** Amounts shown for Zoho push — always from Zoho product tiers + 18% GST, not DOCA totals on the record. */
export function rvZohoInvoiceSummary(
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement'>,
): RvZohoInvoiceSummary | null {
  const capacityKg = maximumCapacityKgFromRecord(record);
  if (capacityKg == null) return null;

  const baseInr = zohoRvProductBaseInr(capacityKg);
  const { total } = verificationFeeWithGst(baseInr);
  return {
    baseInr,
    totalInr: total,
    tierLabel: capacityKg <= 20 ? 'Up to 20 kg' : 'Above 20 kg',
  };
}

export function formatRvZohoInvoiceSummary(summary: RvZohoInvoiceSummary): string {
  return `${formatRcFeeAmount(summary.totalInr)} (${summary.tierLabel}, pre-GST ${formatRcFeeAmount(summary.baseInr)})`;
}

export function verificationZohoInvoiceNumber(
  record: Pick<SiteCalibration, 'zohoInvoiceNumber' | 'zohoInvoiceId'>,
): string | null {
  const number = record.zohoInvoiceNumber?.trim();
  if (number) return number;
  const id = record.zohoInvoiceId?.trim();
  return id || null;
}
