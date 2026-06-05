import {
  rcVerificationFeeQuote,
  rvGatewayFee,
  rvTdsFee,
  sumRcVerificationFees,
  verificationFeeWithGst,
} from './rcProfileFields';
import type { VerificationDeviceRowValues } from './siteCalibrationProfileFields';
import type { JobType, Product, RcFeesStructure, SiteCalibration, VerificationLocation } from '../types';

export type RvPaymentBreakdown = {
  administrativeFees: number;
  gst: number;
  total: number;
  tdsTotal: number;
  gatewayTotal: number;
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
  const gatewayTotal = included.reduce((sum, row) => {
    const product = products.find(entry => entry.id === row.productId) ?? null;
    return sum + rvGatewayFee(product);
  }, 0);
  const administrativeFees = tdsTotal + gatewayTotal;

  return {
    administrativeFees,
    gst,
    total: administrativeFees + gst,
    tdsTotal,
    gatewayTotal,
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

export function isRvPaymentSatisfied(
  record: Pick<SiteCalibration, 'verificationType' | 'rvPaymentStatus' | 'rvPaymentAmount'> | null | undefined,
  expectedAmount: number | null,
): boolean {
  if (!record) return false;
  if (record.verificationType !== 'RV') return true;
  if (record.rvPaymentStatus !== 'paid') return false;
  if (expectedAmount == null) return true;
  return record.rvPaymentAmount === expectedAmount;
}

export function isRvSessionPaymentSatisfied(
  sessionPayment: { paymentId: string; amountInr: number } | null | undefined,
  expectedAmount: number | null,
): boolean {
  if (!sessionPayment || expectedAmount == null) return false;
  return sessionPayment.amountInr === expectedAmount && Boolean(sessionPayment.paymentId);
}
