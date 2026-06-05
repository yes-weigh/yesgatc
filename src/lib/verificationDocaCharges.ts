import { rcVerificationFeeQuote, verificationFeeWithGst } from './rcProfileFields';
import type {
  JobType,
  Product,
  RcFeesStructure,
  SiteCalibration,
  VerificationLocation,
} from '../types';

export type VerificationDocaChargeFields = {
  verificationFeeBase: number;
  verificationFeeGst: number;
  verificationFeeTotal: number;
  carriageConveyanceFee: number;
  totalDeposited: number;
};

export function parseCarriageConveyanceFeeInput(value: string): number {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 0;
  return Math.min(Number.parseInt(digits, 10), 999_999);
}

/** Only RV verifications store fee breakdown on the record; OV leaves fields empty for DOCA automation. */
export function shouldPersistVerificationDocaCharges(verificationType: JobType | ''): boolean {
  return verificationType === 'RV';
}

export function computeVerificationDocaCharges(
  fees: RcFeesStructure,
  verificationType: JobType | '',
  verificationLocation: VerificationLocation | '',
  verificationSubject: 'self' | 'customer' | '',
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null | undefined,
  carriageConveyanceFeeInput = '0',
): VerificationDocaChargeFields | null {
  if (!shouldPersistVerificationDocaCharges(verificationType)) {
    return null;
  }

  const quote = rcVerificationFeeQuote(
    fees,
    verificationLocation,
    product,
    verificationSubject,
    verificationType,
  );
  if (quote.amount == null) return null;

  const { base, gst, total } = verificationFeeWithGst(quote.amount);
  const carriageConveyanceFee = parseCarriageConveyanceFeeInput(carriageConveyanceFeeInput);

  return {
    verificationFeeBase: base,
    verificationFeeGst: gst,
    verificationFeeTotal: total,
    carriageConveyanceFee,
    /** DOCA total deposited matches verification fee (excludes carriage until automation uses it). */
    totalDeposited: total,
  };
}

export function verificationDocaChargesFromRecord(
  record: Pick<
    SiteCalibration,
    | 'verificationFeeBase'
    | 'verificationFeeGst'
    | 'verificationFeeTotal'
    | 'carriageConveyanceFee'
    | 'totalDeposited'
  >,
): VerificationDocaChargeFields | null {
  if (
    record.verificationFeeTotal == null
    || !Number.isFinite(record.verificationFeeTotal)
  ) {
    return null;
  }

  return {
    verificationFeeBase: record.verificationFeeBase ?? 0,
    verificationFeeGst: record.verificationFeeGst ?? 0,
    verificationFeeTotal: record.verificationFeeTotal,
    carriageConveyanceFee: record.carriageConveyanceFee ?? 0,
    totalDeposited: record.totalDeposited ?? record.verificationFeeTotal,
  };
}
