import { isRvWalletPaymentRequired } from './appSettings';
import {
  rcVerificationFeeQuote,
  rvTdsFee,
  sumRcVerificationFees,
  verificationFeeWithGst,
} from './rcProfileFields';
import {
  verificationSessionFromRecord,
  type VerificationDeviceRowValues,
} from './siteCalibrationProfileFields';
import { normalizeVerificationStatus } from './verificationRequest';
import type { JobType, Product, RcFeesStructure, SiteCalibration, VerificationLocation } from '../types';

export type RvPaymentBreakdown = {
  administrativeFees: number;
  gst: number;
  total: number;
  tdsTotal: number;
  gatewayTotal: number;
};

export function computeRvPaymentAmountForRow(
  row: VerificationDeviceRowValues,
  products: Product[],
  fees: RcFeesStructure,
  verificationLocation: VerificationLocation | '',
  verificationSubject: 'self' | 'customer',
  verificationType: JobType | '',
): RvPaymentBreakdown | null {
  if (!row.included) return null;
  return computeRvPaymentAmount(
    [row],
    products,
    fees,
    verificationLocation,
    verificationSubject,
    verificationType,
  );
}

export function computeRvPaymentAmount(
  devices: VerificationDeviceRowValues[],
  products: Product[],
  fees: RcFeesStructure,
  verificationLocation: VerificationLocation | '',
  verificationSubject: 'self' | 'customer',
  verificationType: JobType | '',
): RvPaymentBreakdown | null {
  if (verificationType !== 'RV') return null;

  const included = devices.filter(device => device.included);
  if (included.length === 0) return null;

  const quotes = included.map(row => {
    const product = products.find(entry => entry.id === row.productId) ?? null;
    return rcVerificationFeeQuote(
      fees,
      verificationLocation,
      product,
      verificationSubject,
      verificationType,
    );
  });

  const quotedBase = sumRcVerificationFees(quotes);
  if (quotedBase <= 0) return null;

  const { gst } = verificationFeeWithGst(quotedBase);
  const tdsTotal = included.reduce((sum, row) => {
    const product = products.find(entry => entry.id === row.productId) ?? null;
    return sum + rvTdsFee(product);
  }, 0);
  const administrativeFees = tdsTotal;

  return {
    administrativeFees,
    gst,
    total: administrativeFees + gst,
    tdsTotal,
    gatewayTotal: 0,
  };
}

export function buildRvPaymentFirestorePatch(paymentId: string, amountInr: number) {
  return {
    rvPaymentStatus: 'paid' as const,
    rvPaymentId: paymentId,
    rvPaymentAmount: amountInr,
    rvPaidAt: new Date().toISOString(),
  };
}

function inrAmountsMatch(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

export function isRvPaymentSatisfied(
  record: Pick<SiteCalibration, 'verificationType' | 'rvPaymentStatus' | 'rvPaymentAmount' | 'rvPaymentId'> | null | undefined,
  expectedAmount: number | null,
): boolean {
  if (!record) return false;
  if (record.verificationType !== 'RV') return true;
  if (record.rvPaymentStatus !== 'paid') return false;
  if (expectedAmount == null) return true;
  if (inrAmountsMatch(record.rvPaymentAmount, expectedAmount)) return true;
  // Legacy batch submit stored session total on each record; wallet still paid once.
  if (
    record.rvPaymentId?.startsWith('wallet:')
    && record.rvPaymentAmount != null
    && record.rvPaymentAmount > expectedAmount
  ) {
    return true;
  }
  return false;
}

/** Per-instrument wallet amount for list, receipt, and display (not session total). */
export function resolveRvWalletDisplayAmount(
  record: SiteCalibration,
  products: Product[],
  fees: RcFeesStructure,
): number | null {
  if (record.verificationType !== 'RV' || record.rvPaymentStatus !== 'paid') return null;

  const computed = computeRvPaymentBreakdownForRecord(record, products, fees)?.total ?? null;
  const stored = record.rvPaymentAmount;

  if (computed == null || computed <= 0) {
    return stored != null && Number.isFinite(stored) && stored > 0 ? Math.round(stored) : null;
  }

  if (stored == null || !Number.isFinite(stored)) return Math.round(computed);
  if (inrAmountsMatch(stored, computed)) return Math.round(stored);
  if (stored > computed) return Math.round(computed);
  return Math.round(stored);
}

export function isRvSessionPaymentSatisfied(
  sessionPayment: { paymentId: string; amountInr: number } | null | undefined,
  expectedAmount: number | null,
): boolean {
  if (!sessionPayment || expectedAmount == null) return false;
  return inrAmountsMatch(sessionPayment.amountInr, expectedAmount) && Boolean(sessionPayment.paymentId);
}

export function computeRvPaymentBreakdownForRecord(
  record: SiteCalibration,
  products: Product[],
  fees: RcFeesStructure,
): RvPaymentBreakdown | null {
  const session = verificationSessionFromRecord(record);
  return computeRvPaymentAmount(
    session.devices,
    products,
    fees,
    session.verificationLocation,
    session.verificationSubject,
    session.verificationType,
  );
}

/** Submitted RV records that still owe wallet administrative fees (e.g. before pay-before-submit). */
export function isRvWalletPaymentOutstanding(
  record: Pick<SiteCalibration, 'verificationType' | 'rvPaymentStatus' | 'status'> | null | undefined,
): boolean {
  if (!record || record.verificationType !== 'RV') return false;
  if (!isRvWalletPaymentRequired('RV')) return false;
  if (record.rvPaymentStatus === 'paid') return false;
  return normalizeVerificationStatus(record as SiteCalibration) !== 'draft';
}
