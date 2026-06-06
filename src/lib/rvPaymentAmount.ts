import { isRvWalletPaymentRequired, type AppGlobalSettings } from './appSettings';
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

/** ₹1 test order for Super Admin Razorpay / site-whitelist checks. */
export const RV_PAYMENT_TEST_BREAKDOWN: RvPaymentBreakdown = {
  administrativeFees: 1,
  gst: 0,
  total: 1,
  tdsTotal: 0,
  gatewayTotal: 0,
};

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
  record: Pick<SiteCalibration, 'verificationType' | 'rvPaymentStatus' | 'rvPaymentAmount'> | null | undefined,
  expectedAmount: number | null,
): boolean {
  if (!record) return false;
  if (record.verificationType !== 'RV') return true;
  if (record.rvPaymentStatus !== 'paid') return false;
  if (expectedAmount == null) return true;
  return inrAmountsMatch(record.rvPaymentAmount, expectedAmount);
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
  settings: AppGlobalSettings,
): boolean {
  if (!record || record.verificationType !== 'RV') return false;
  if (!isRvWalletPaymentRequired('RV', settings)) return false;
  if (record.rvPaymentStatus === 'paid') return false;
  return normalizeVerificationStatus(record as SiteCalibration) !== 'draft';
}
