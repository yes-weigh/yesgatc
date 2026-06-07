import { VERIFICATION_LABEL_BRANDING } from './verificationLabel';
import { inrAmountToWords } from './inrAmountToWords';
import { rvZohoInvoiceSummary } from './zohoRvSubmit';
import type { Customer, SiteCalibration } from '../types';

/** Thermal receipt width for GST bill preview / print. */
export const VERIFICATION_GST_BILL_RECEIPT = {
  widthMm: 80,
  previewWidthPx: 300,
  printDotsPerMm: 8,
  printRotationDeg: 0 as const,
} as const;

export const VERIFICATION_GST_BILL_BRANDING = {
  companyName: VERIFICATION_LABEL_BRANDING.companyName,
  addressLines: [
    '49/470 D1, 3RD FLOOR',
    'ASIAN TOWER',
    'VYTTILA, ERNAKULAM',
    'KERALA - 682019',
  ] as const,
  gstin: '32AAFCI1950F1ZZ',
  placeOfSupply: 'Kerala (32)',
  invoiceType: 'B2C (Unregistered)',
  paymentMode: 'UPI / Cash / Card',
  gatcApprovalNumber: 'IND/GATC/KL/26/04',
  footerLines: [
    'Thank You!',
    'Interweighing Pvt Ltd',
    'Government approved Test Center',
    'IND/GATC/KL/26/04',
  ] as const,
} as const;

export type VerificationGstBillData = {
  invoiceNumber: string;
  invoiceDateTime: string;
  customerName: string;
  customerLocation: string;
  certificateNumber: string;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
  amountInWords: string;
  missingFields: string[];
};

export function formatGstBillMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatGstBillLineAmount(amount: number): string {
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatBillDateTime(iso?: string): string {
  if (!iso?.trim()) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';

  return `${dd}-${mm}-${yyyy} ${hours12}:${minutes} ${meridiem}`;
}

function resolveInvoiceNumber(record: SiteCalibration): string {
  return (
    record.zohoInvoiceNumber?.trim()
    || record.applicationNumber?.trim()
    || '—'
  );
}

function resolveTaxableValue(record: SiteCalibration): number | null {
  if (typeof record.verificationFeeBase === 'number' && record.verificationFeeBase > 0) {
    return Math.round(record.verificationFeeBase);
  }

  const zohoSummary = rvZohoInvoiceSummary(record);
  if (zohoSummary?.baseInr) return zohoSummary.baseInr;

  if (typeof record.verificationFeeTotal === 'number' && record.verificationFeeTotal > 0) {
    return Math.round(record.verificationFeeTotal / 1.18);
  }

  return null;
}

function splitKeralaGst(taxableValue: number): { cgst: number; sgst: number; total: number } {
  const cgst = Math.round(taxableValue * 0.09);
  const sgst = Math.round(taxableValue * 0.09);
  return { cgst, sgst, total: taxableValue + cgst + sgst };
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

export function buildVerificationGstBillData(
  record: SiteCalibration,
  customer?: Customer | null,
): VerificationGstBillData {
  const missingFields: string[] = [];
  const taxableValue = resolveTaxableValue(record);
  const { cgst, sgst, total } = taxableValue
    ? splitKeralaGst(taxableValue)
    : { cgst: 0, sgst: 0, total: 0 };

  const invoiceNumber = resolveInvoiceNumber(record);
  if (invoiceNumber === '—') missingFields.push('Invoice number');

  const invoiceDateTime = formatBillDateTime(
    record.certifiedAt || record.submittedAt || record.approvedAt,
  );
  if (invoiceDateTime === '—') missingFields.push('Invoice date');

  const customerName = record.customerName?.trim() || customer?.name?.trim() || '—';
  if (customerName === '—') missingFields.push('Customer name');

  const customerLocation = formatCustomerLocation(customer);
  const certificateNumber = record.certificateNumber?.trim() || '—';
  if (certificateNumber === '—') missingFields.push('Certificate number');

  if (taxableValue == null || taxableValue <= 0) {
    missingFields.push('Verification fee');
  }

  const totalAmount =
    typeof record.verificationFeeTotal === 'number' && record.verificationFeeTotal > 0
      ? Math.round(record.verificationFeeTotal)
      : total;

  return {
    invoiceNumber,
    invoiceDateTime,
    customerName,
    customerLocation,
    certificateNumber,
    taxableValue: taxableValue ?? 0,
    cgstAmount: cgst,
    sgstAmount: sgst,
    totalAmount,
    amountInWords: inrAmountToWords(totalAmount),
    missingFields,
  };
}

/** Plain-text GST bill summary for WhatsApp share. */
export function buildVerificationGstBillShareMessage(bill: VerificationGstBillData): string {
  return [
    VERIFICATION_GST_BILL_BRANDING.companyName,
    ...VERIFICATION_GST_BILL_BRANDING.addressLines,
    `GSTIN : ${VERIFICATION_GST_BILL_BRANDING.gstin}`,
    '',
    'TAX INVOICE (B2C)',
    'FORM 8B RECEIPT',
    '',
    `Invoice No : ${bill.invoiceNumber}`,
    `Date : ${bill.invoiceDateTime}`,
    `Customer : ${bill.customerName}`,
    `Location : ${bill.customerLocation}`,
    '',
    `Verification Fees : ${formatGstBillMoney(bill.taxableValue)}`,
    `CGST @ 9% : ${formatGstBillMoney(bill.cgstAmount)}`,
    `SGST @ 9% : ${formatGstBillMoney(bill.sgstAmount)}`,
    `TOTAL : ${formatGstBillMoney(bill.totalAmount)}`,
    bill.amountInWords,
    '',
    `Certificate No : ${bill.certificateNumber}`,
    VERIFICATION_GST_BILL_BRANDING.footerLines[0],
  ].join('\n');
}
