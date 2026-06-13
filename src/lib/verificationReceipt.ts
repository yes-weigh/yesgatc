import { resolveRvWalletDisplayAmount } from './rvPaymentAmount';
import { inrAmountToWords } from './inrAmountToWords';
import { VERIFICATION_GST_BILL_BRANDING, VERIFICATION_GST_BILL_RECEIPT } from './verificationGstBill';
import type { Customer, Product, RcFeesStructure, SiteCalibration } from '../types';

/** Thermal receipt width for wallet charge preview / print — same as GST bill. */
export const VERIFICATION_RECEIPT_THERMAL = VERIFICATION_GST_BILL_RECEIPT;

export const VERIFICATION_RECEIPT_BRANDING = {
  companyName: VERIFICATION_GST_BILL_BRANDING.companyName,
  addressLines: VERIFICATION_GST_BILL_BRANDING.addressLines,
  gstin: VERIFICATION_GST_BILL_BRANDING.gstin,
  paymentMode: 'Wallet',
  footerLines: VERIFICATION_GST_BILL_BRANDING.footerLines,
} as const;

export const VERIFICATION_RECEIPT_LINE_DESCRIPTION = 'Wallet Charge';

export type VerificationReceiptData = {
  receiptNumber: string;
  receiptDate: string;
  receiptTime: string;
  customerName: string;
  customerLocation: string;
  lineDescription: string;
  amount: number;
  totalAmount: number;
  amountInWords: string;
  missingFields: string[];
};

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

function formatCustomerLocation(customer?: Customer | null): string {
  if (!customer) return '—';
  const district = customer.district?.trim();
  const state = customer.state?.trim() || 'Kerala';
  if (district) return `${district}, ${state}`;
  const address = customer.address?.trim();
  if (address) return address;
  return state;
}

export function resolveRvWalletChargeAmount(
  record: SiteCalibration,
  products: Product[],
  fees: RcFeesStructure,
): number | null {
  return resolveRvWalletDisplayAmount(record, products, fees);
}

export function canShowVerificationWalletReceipt(record: SiteCalibration): boolean {
  return record.verificationType === 'RV' && record.rvPaymentStatus === 'paid';
}

export function buildVerificationReceiptData(
  record: SiteCalibration,
  customer: Customer | null | undefined,
  products: Product[],
  fees: RcFeesStructure,
): VerificationReceiptData {
  const missingFields: string[] = [];
  const paidAt = record.rvPaidAt || record.submittedAt || record.certifiedAt;

  const receiptNumber = resolveReceiptNumber(record);
  if (receiptNumber === '—') missingFields.push('Receipt number');

  const receiptDate = formatReceiptDate(paidAt);
  const receiptTime = formatReceiptTime(paidAt);
  if (receiptDate === '—') missingFields.push('Receipt date');
  if (receiptTime === '—') missingFields.push('Receipt time');

  const customerName = record.customerName?.trim() || customer?.name?.trim() || '—';
  if (customerName === '—') missingFields.push('Customer name');

  const customerLocation = formatCustomerLocation(customer);
  const amount = resolveRvWalletChargeAmount(record, products, fees);
  if (amount == null || amount <= 0) missingFields.push('Wallet charge');

  const totalAmount = amount ?? 0;

  return {
    receiptNumber,
    receiptDate,
    receiptTime,
    customerName,
    customerLocation,
    lineDescription: VERIFICATION_RECEIPT_LINE_DESCRIPTION,
    amount: totalAmount,
    totalAmount,
    amountInWords: inrAmountToWords(totalAmount),
    missingFields,
  };
}
