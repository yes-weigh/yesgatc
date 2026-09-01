import { formatProductMpe } from './productCalculations';
import { resolveVerificationProduct } from './verificationPartyDetails';
import { verificationVctLabel } from './verificationRequest';
import { VERIFICATION_LABEL_BRANDING } from './verificationLabel';
import { inrAmountToWords } from './inrAmountToWords';
import { buildCertificateVerifyUrl } from './certificateVerifyUrl';
import {
  computeStoredGstBill,
  isStoredGstBill,
} from './rvGstBillRates';
import type { Customer, Product, SiteCalibration } from '../types';

/** Thermal receipt width for GST bill preview / print. 58mm heads are 384 dots. */
export const VERIFICATION_GST_BILL_RECEIPT = {
  widthMm: 58,
  previewWidthPx: 300,
  printDotsPerMm: 8,
  printWidthDots: 384,
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

export const VERIFICATION_GST_BILL_LINE_DESCRIPTION = 'Re-Verification Fees (GATC)';
export const VERIFICATION_GST_BILL_SAC_LINE = 'SAC : 998346';
export const VERIFICATION_GST_BILL_QR_CAPTION = 'Scan QR to verify';

export type GstBillInstrumentLine = {
  label: string;
  value: string;
  span?: 'full' | 'half';
  plain?: boolean;
};

export type VerificationGstBillData = {
  invoiceNumber: string;
  invoiceDateTime: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerPincode: string;
  customerDistrict: string;
  customerState: string;
  certificateNumber: string;
  instrumentLines: GstBillInstrumentLine[];
  verifyUrl: string | null;
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

function resolveGstAmounts(record: SiteCalibration): {
  taxableValue: number | null;
  cgst: number;
  sgst: number;
  total: number;
} {
  const computed = computeStoredGstBill(record);
  if (
    isStoredGstBill(record.gstBill)
    && (!computed || record.gstBill.rateDate === computed.rateDate)
  ) {
    return {
      taxableValue: record.gstBill.taxableValue,
      cgst: record.gstBill.cgstAmount,
      sgst: record.gstBill.sgstAmount,
      total: record.gstBill.totalAmount,
    };
  }

  if (!computed) {
    return { taxableValue: null, cgst: 0, sgst: 0, total: 0 };
  }

  return {
    taxableValue: computed.taxableValue,
    cgst: computed.cgstAmount,
    sgst: computed.sgstAmount,
    total: computed.totalAmount,
  };
}

function formatCustomerField(value?: string | null): string {
  return value?.trim() || '—';
}

export function resolveGstBillCustomerContact(
  record: Pick<SiteCalibration, 'customerName'>,
  customer?: Customer | null,
): {
  name: string;
  phone: string;
  address: string;
  pincode: string;
  district: string;
  state: string;
} {
  const district = customer?.district?.trim() || '';
  const state = customer?.state?.trim() || (district ? 'Kerala' : '');
  return {
    name: record.customerName?.trim() || customer?.name?.trim() || '—',
    phone: formatCustomerField(customer?.phone),
    address: formatCustomerField(customer?.address),
    pincode: formatCustomerField(customer?.pincode),
    district: formatCustomerField(district),
    state: formatCustomerField(state),
  };
}

function gstBillDash(value?: string | number | null): string {
  if (value == null) return '—';
  const text = String(value).trim();
  return text || '—';
}

function gstBillQty(value?: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return String(Math.round(value * 1e6) / 1e6);
}

function gstBillInstrumentSpecLines(
  record: SiteCalibration,
  product?: Product | null,
): GstBillInstrumentLine[] {
  const productInfo = resolveVerificationProduct(record, product);
  const max = gstBillQty(record.maximumCapacity ?? product?.maximumCapacity);
  const e = gstBillQty(record.verificationScaleInterval ?? product?.verificationScaleInterval);
  const unit = record.unitOfMeasurement || product?.unitOfMeasurement || 'kg';
  const mpeRaw = formatProductMpe(record.maximumPermissibleError ?? product?.maximumPermissibleError);
  const accuracyClass = productInfo.accuracyClass || 'III';

  return [
    { label: 'Max', value: max != null ? `${max}${unit}` : '—', span: 'half' },
    { label: 'e', value: e != null ? `${e}g` : '—', span: 'half' },
    { label: 'Class', value: accuracyClass, span: 'half' },
    { label: 'MPE', value: mpeRaw === '—' ? '—' : `${mpeRaw}g`, span: 'half' },
  ];
}

export function buildGstBillInstrumentLines(
  record: SiteCalibration,
  product?: Product | null,
): GstBillInstrumentLine[] {
  const productInfo = resolveVerificationProduct(record, product);
  return [
    { label: 'Certificate No', value: gstBillDash(record.certificateNumber), span: 'full' },
    { label: 'Machine No', value: gstBillDash(record.serialNumber), span: 'half' },
    { label: 'Mfg Year', value: gstBillDash(record.manufacturingYear), span: 'half' },
    { label: 'Instrument', value: gstBillDash(productInfo.name), span: 'full' },
    { label: 'Manufacturer', value: gstBillDash(productInfo.manufacturer), span: 'full' },
    { label: 'Model Approval No', value: gstBillDash(productInfo.modelApprovalNo), span: 'full' },
    ...gstBillInstrumentSpecLines(record, product),
    { label: 'VCT', value: gstBillDash(verificationVctLabel(record)), span: 'full' },
    { label: 'Seal ID', value: gstBillDash(record.sealIdentificationNumber), span: 'full' },
  ];
}

export function groupGstBillInstrumentRows(
  lines: GstBillInstrumentLine[],
): Array<
  | { kind: 'full'; line: GstBillInstrumentLine }
  | { kind: 'pair'; left: GstBillInstrumentLine; right: GstBillInstrumentLine }
> {
  const rows: Array<
    | { kind: 'full'; line: GstBillInstrumentLine }
    | { kind: 'pair'; left: GstBillInstrumentLine; right: GstBillInstrumentLine }
  > = [];
  for (let i = 0; i < lines.length; ) {
    const current = lines[i]!;
    const next = lines[i + 1];
    if (current.span === 'half' && next?.span === 'half') {
      rows.push({ kind: 'pair', left: current, right: next });
      i += 2;
      continue;
    }
    rows.push({ kind: 'full', line: current });
    i += 1;
  }
  return rows;
}

export function buildVerificationGstBillData(
  record: SiteCalibration,
  customer?: Customer | null,
  product?: Product | null,
): VerificationGstBillData {
  const missingFields: string[] = [];
  const { taxableValue, cgst, sgst, total } = resolveGstAmounts(record);

  const invoiceNumber = resolveInvoiceNumber(record);
  if (invoiceNumber === '—') missingFields.push('Invoice number');

  const invoiceDateTime = formatBillDateTime(
    record.certifiedAt || record.submittedAt || record.approvedAt,
  );
  if (invoiceDateTime === '—') missingFields.push('Invoice date');

  const contact = resolveGstBillCustomerContact(record, customer);
  if (contact.name === '—') missingFields.push('Customer name');

  const certificateNumber = record.certificateNumber?.trim() || '—';
  if (certificateNumber === '—') missingFields.push('Certificate number');

  if (taxableValue == null || taxableValue <= 0) {
    missingFields.push('Verification fee');
  }

  const totalAmount = total;

  return {
    invoiceNumber,
    invoiceDateTime,
    customerName: contact.name,
    customerPhone: contact.phone,
    customerAddress: contact.address,
    customerPincode: contact.pincode,
    customerDistrict: contact.district,
    customerState: contact.state,
    certificateNumber,
    instrumentLines: buildGstBillInstrumentLines(record, product),
    verifyUrl: buildCertificateVerifyUrl(record),
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
    `Phone : ${bill.customerPhone}`,
    `Place : ${bill.customerAddress}`,
    `Pincode : ${bill.customerPincode}`,
    `District : ${bill.customerDistrict}`,
    `State : ${bill.customerState}`,
    '',
    `${VERIFICATION_GST_BILL_LINE_DESCRIPTION} : ${formatGstBillMoney(bill.taxableValue)}`,
    VERIFICATION_GST_BILL_SAC_LINE,
    `CGST @ 9% : ${formatGstBillMoney(bill.cgstAmount)}`,
    `SGST @ 9% : ${formatGstBillMoney(bill.sgstAmount)}`,
    `TOTAL : ${formatGstBillMoney(bill.totalAmount)}`,
    bill.amountInWords,
    '',
    'Instrument Details',
    ...bill.instrumentLines.map(line =>
      line.plain ? line.value : `${line.label} : ${line.value}`,
    ),
    ...(bill.verifyUrl
      ? [VERIFICATION_GST_BILL_QR_CAPTION, bill.verifyUrl]
      : []),
    VERIFICATION_GST_BILL_BRANDING.footerLines[0],
  ].join('\n');
}
