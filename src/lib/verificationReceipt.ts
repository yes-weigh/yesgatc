import { inrAmountToWords } from './inrAmountToWords';
import { rcAllowsCashReceiptFromUser } from './rcCertificationMethod';
import { computeRvCustomerFeeLineForRecord } from './rvFeeBreakdown';
import { resolveGstBillCustomerContact, VERIFICATION_GST_BILL_RECEIPT } from './verificationGstBill';
import type { Customer, FirestoreUserDoc, Product, RcFeesStructure, SiteCalibration } from '../types';

/** Thermal receipt width for wallet charge preview / print — same as GST bill. */
export const VERIFICATION_RECEIPT_THERMAL = VERIFICATION_GST_BILL_RECEIPT;

export const VERIFICATION_RECEIPT_PAYMENT_MODE = 'UPI/Cash';

export const VERIFICATION_RECEIPT_RC_FEES_LABEL = 'RC fees';

export type VerificationReceiptIssuer = {
  companyName: string;
  addressLines: string[];
  /** RC contact phone — shown in cash receipt header (no GSTIN). */
  phone: string;
  paymentMode: string;
};

export type VerificationReceiptLine = {
  description: string;
  amount: number;
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
  vctName: string;
  vctNumber: string;
  /** @deprecated use lines — kept for older print callers */
  lineDescription: string;
  /** @deprecated use lines */
  amount: number;
  lines: VerificationReceiptLine[];
  /** Cash collected by RC = admin package − Interweighing (GATC + GST) ± add/discount. */
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
    | 'phone'
  > | null | undefined,
): VerificationReceiptIssuer {
  const companyName = receiptCaps(rc?.companyName?.trim() || rc?.username?.trim() || 'REGIONAL CENTRE');
  const phoneDigits = (rc?.phone ?? '').replace(/\D/g, '');
  const phone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : (rc?.phone?.trim() || '');

  return {
    companyName,
    addressLines: cashReceiptAddressLinesFromRc(rc),
    phone,
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

/** Cash RC collects = package − Interweighing (GATC + GST) ± additional/discount. */
export function resolveRvCashReceiptAmount(
  record: SiteCalibration,
  products: Product[],
  fees: RcFeesStructure,
): number | null {
  const line = computeRvCustomerFeeLineForRecord(record, products, fees);
  const amount = line?.netRcFees;
  return amount != null && amount > 0 ? amount : null;
}

/** RV paid + RC uses Auto DSC or PDF signer (not Manual upload). */
export function canShowVerificationWalletReceipt(
  record: SiteCalibration,
  rc?: Pick<FirestoreUserDoc, 'certificationMethod'> | null,
): boolean {
  if (record.verificationType !== 'RV' || record.rvPaymentStatus !== 'paid') return false;
  if (rc === undefined) return true;
  return rcAllowsCashReceiptFromUser(rc);
}

function formatReceiptPhone(raw: string | null | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return String(raw || '').trim();
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
    | 'phone'
    | 'contactPerson'
  > | null,
  vct?: Pick<FirestoreUserDoc, 'username' | 'phone' | 'contactPerson'> | null,
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

  const feeLine = computeRvCustomerFeeLineForRecord(record, products, fees);
  const rcFeesCash = feeLine?.netRcFees ?? 0;
  const cashTotal = resolveRvCashReceiptAmount(record, products, fees);
  if (cashTotal == null || cashTotal <= 0) missingFields.push('Total');

  const totalAmount = cashTotal ?? 0;
  const lines: VerificationReceiptLine[] = [];
  if (rcFeesCash > 0) {
    lines.push({ description: VERIFICATION_RECEIPT_RC_FEES_LABEL, amount: rcFeesCash });
  } else if (totalAmount > 0) {
    lines.push({ description: VERIFICATION_RECEIPT_RC_FEES_LABEL, amount: totalAmount });
  }

  const vctName = receiptCaps(
    record.vctName?.trim()
      || vct?.contactPerson?.trim()
      || vct?.username?.trim()
      || (record.performedBy === 'rc'
        ? rc?.contactPerson?.trim() || rc?.username?.trim() || ''
        : '')
      || '',
  );
  const vctNumber =
    formatReceiptPhone(vct?.phone)
    || (record.performedBy === 'rc' ? formatReceiptPhone(rc?.phone) : '');
  if (!vctName) missingFields.push('VCT name');
  if (!vctNumber) missingFields.push('VCT number');

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
    vctName: vctName || '—',
    vctNumber: vctNumber || '—',
    lineDescription: VERIFICATION_RECEIPT_RC_FEES_LABEL,
    amount: totalAmount,
    lines,
    totalAmount,
    amountInWords: inrAmountToWords(totalAmount),
    missingFields,
  };
}
