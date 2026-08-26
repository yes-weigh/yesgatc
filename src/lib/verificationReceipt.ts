import { inrAmountToWords } from './inrAmountToWords';
import { computeRvCustomerFeeLineForRecord } from './rvFeeBreakdown';
import { resolveGstBillCustomerContact, VERIFICATION_GST_BILL_RECEIPT } from './verificationGstBill';
import type { Customer, FirestoreUserDoc, Product, RcFeesStructure, SiteCalibration } from '../types';

/** Thermal receipt width for wallet charge preview / print — same as GST bill. */
export const VERIFICATION_RECEIPT_THERMAL = VERIFICATION_GST_BILL_RECEIPT;

export const VERIFICATION_RECEIPT_PAYMENT_MODE = 'UPI/Cash';

export const VERIFICATION_RECEIPT_LINE_DESCRIPTION = 'Service charges';

export type VerificationReceiptIssuer = {
  companyName: string;
  addressLines: string[];
  gstin: string;
  paymentMode: string;
};

export type VerificationReceiptData = {
  issuer: VerificationReceiptIssuer;
  receiptNumber: string;
  receiptDate: string;
  receiptTime: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerPincode: string;
  customerDistrict: string;
  customerState: string;
  lineDescription: string;
  amount: number;
  totalAmount: number;
  amountInWords: string;
  missingFields: string[];
};

function receiptCaps(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

const RECEIPT_SKIP_PARTS = new Set(['INDIA', 'IN', 'BHARAT']);

function receiptAddressPart(raw: string): string {
  return receiptCaps(raw).replace(/^[\s,./-]+|[\s,./-]+$/g, '');
}

/** Two compact lines: street, then city / district / Kerala - PIN. Drops India. */
export function cashReceiptAddressLinesFromRc(
  rc: Pick<FirestoreUserDoc, 'address' | 'place' | 'pincode'> | null | undefined,
): string[] {
  if (!rc) return [];

  const seen = new Set<string>();
  const parts: string[] = [];
  const add = (raw: string) => {
    const line = receiptAddressPart(raw);
    if (!line || RECEIPT_SKIP_PARTS.has(line) || seen.has(line)) return;
    seen.add(line);
    parts.push(line);
  };

  const address = rc.address?.trim() ?? '';
  if (address) {
    const chunks = /\n/.test(address) ? address.split(/\n+/) : address.split(',');
    chunks.forEach(add);
  }
  if (rc.place?.trim()) add(rc.place);

  let pin = (rc.pincode ?? '').replace(/\D/g, '').slice(0, 6);
  const places: string[] = [];
  for (const part of parts) {
    const found = part.match(/(\d{6})/);
    if (found && !pin) pin = found[1];
    const stripped = part
      .replace(/[\s-]*\d{6}\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[-,]+|[-,]+$/g, '');
    if (!stripped || stripped === 'KERALA' || stripped === 'KL') continue;
    places.push(stripped);
  }

  const pinLine = pin ? `KERALA - ${pin}` : parts.some(part => part.includes('KERALA')) ? 'KERALA' : '';
  if (places.length === 0) return pinLine ? [pinLine] : [];
  if (places.length === 1) return pinLine ? [places[0], pinLine] : places;

  const street = places.slice(0, 2).join(', ');
  const locality = [...places.slice(2), pinLine].filter(Boolean).join(', ');
  return locality ? [street, locality] : [street];
}

export function buildCashReceiptIssuerFromRc(
  rc: Pick<
    FirestoreUserDoc,
    | 'companyName'
    | 'username'
    | 'address'
    | 'place'
    | 'pincode'
    | 'gstNumber'
  > | null | undefined,
): VerificationReceiptIssuer {
  const companyName = receiptCaps(rc?.companyName?.trim() || rc?.username?.trim() || 'REGIONAL CENTRE');

  return {
    companyName,
    addressLines: cashReceiptAddressLinesFromRc(rc),
    gstin: rc?.gstNumber?.trim().toUpperCase() || '',
    paymentMode: VERIFICATION_RECEIPT_PAYMENT_MODE,
  };
}

export function formatReceiptMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatReceiptLineAmount(amount: number): string {
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatReceiptDate(iso?: string): string {
  if (!iso?.trim()) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatReceiptTime(iso?: string): string {
  if (!iso?.trim()) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  return `${String(hours12).padStart(2, '0')}:${minutes} ${meridiem}`;
}

function resolveReceiptNumber(record: SiteCalibration): string {
  const applicationNumber = record.applicationNumber?.trim();
  if (applicationNumber) {
    return applicationNumber.replace(/^APP/i, 'CR');
  }

  const paymentId = record.rvPaymentId?.trim();
  if (paymentId?.startsWith('wallet:')) {
    const ledgerId = paymentId.slice('wallet:'.length).trim();
    if (ledgerId) return `CR/${ledgerId.slice(0, 12).toUpperCase()}`;
  }

  return '—';
}

export function resolveRvCashReceiptAmount(
  record: SiteCalibration,
  products: Product[],
  fees: RcFeesStructure,
): number | null {
  const total = computeRvCustomerFeeLineForRecord(record, products, fees)?.total;
  return total != null && total > 0 ? total : null;
}

export function canShowVerificationWalletReceipt(record: SiteCalibration): boolean {
  return record.verificationType === 'RV' && record.rvPaymentStatus === 'paid';
}

export function buildVerificationReceiptData(
  record: SiteCalibration,
  customer: Customer | null | undefined,
  products: Product[],
  fees: RcFeesStructure,
  rc?: Pick<
    FirestoreUserDoc,
    | 'companyName'
    | 'username'
    | 'address'
    | 'place'
    | 'pincode'
    | 'gstNumber'
  > | null,
): VerificationReceiptData {
  const missingFields: string[] = [];
  const paidAt = record.rvPaidAt || record.submittedAt || record.certifiedAt;

  const receiptNumber = resolveReceiptNumber(record);
  if (receiptNumber === '—') missingFields.push('Receipt number');

  const receiptDate = formatReceiptDate(paidAt);
  const receiptTime = formatReceiptTime(paidAt);
  if (receiptDate === '—') missingFields.push('Receipt date');
  if (receiptTime === '—') missingFields.push('Receipt time');

  const contact = resolveGstBillCustomerContact(record, customer);
  if (contact.name === '—') missingFields.push('Customer name');

  const amount = resolveRvCashReceiptAmount(record, products, fees);
  if (amount == null || amount <= 0) missingFields.push('Total');

  const totalAmount = amount ?? 0;

  return {
    issuer: buildCashReceiptIssuerFromRc(rc),
    receiptNumber,
    receiptDate,
    receiptTime,
    customerName: contact.name,
    customerPhone: contact.phone,
    customerAddress: contact.address,
    customerPincode: contact.pincode,
    customerDistrict: contact.district,
    customerState: contact.state,
    lineDescription: VERIFICATION_RECEIPT_LINE_DESCRIPTION,
    amount: totalAmount,
    totalAmount,
    amountInWords: inrAmountToWords(totalAmount),
    missingFields,
  };
}
