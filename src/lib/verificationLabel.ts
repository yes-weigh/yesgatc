import { normalizePhone } from './contactFields';
import { buildDocaCertificateViewUrl } from './docaCertificateUrl';
import type { SiteCalibration } from '../types';

/** Sticker canvas — 40 × 60 mm portrait at print. */
export const VERIFICATION_LABEL_STICKER = {
  widthMm: 40,
  heightMm: 60,
  /** Screen preview width (height follows aspect ratio). */
  previewWidthPx: 240,
  /** Thermal resolution — 203 dpi ≈ 8 dots/mm. */
  printDotsPerMm: 8,
  /**
   * Rotate the captured label before Bluetooth print (rotated label stock).
   * 90 = clockwise; use 270 if your printer prints upside-down.
   */
  printRotationDeg: 90 as 0 | 90 | 180 | 270,
} as const;

/** Footer branding on printed verification labels. */
export const VERIFICATION_LABEL_BRANDING = {
  companyName: 'INTERWEIGHING PVT LTD',
  /** Fixed GATC approval number for Interweighing (not per-verification model approval). */
  gatcApprovalNumber: 'IND/GATC/26/04',
  logoSrc: '/brand/label-logo.png',
  logoAlt: 'WEIGH LAB',
  governmentApprovedLines: ['GOVERNMENT', 'APPROVED', 'TEST CENTRE'] as const,
} as const;

export type VerificationLabelData = {
  approvalNumber: string;
  certificateNumber: string;
  validTill: string;
  verifyUrl: string | null;
  rcPhoneDisplay: string;
  rcWhatsAppUrl: string | null;
  missingFields: string[];
};

/** Ten-digit display for sticker (e.g. 9847098300). */
export function formatVerificationLabelPhone(phone?: string | null): string {
  const digits = normalizePhone(phone ?? '');
  if (digits.length === 10) return digits;
  const trimmed = phone?.trim();
  return trimmed || '—';
}

export function buildVerificationLabelWhatsAppUrl(phone?: string | null): string | null {
  const digits = normalizePhone(phone ?? '');
  if (digits.length !== 10) return null;
  return `https://wa.me/91${digits}`;
}

/** One-year validity ending the day before the certification anniversary. */
export function verificationValidUptoDate(certifiedAt?: string): Date | null {
  if (!certifiedAt?.trim()) return null;
  try {
    const date = new Date(certifiedAt);
    if (Number.isNaN(date.getTime())) return null;
    date.setFullYear(date.getFullYear() + 1);
    date.setDate(date.getDate() - 1);
    return date;
  } catch {
    return null;
  }
}

/** Label date format — DD-MM-YYYY (e.g. 05-05-2027). */
export function formatVerificationLabelValidTill(certifiedAt?: string): string {
  const date = verificationValidUptoDate(certifiedAt);
  if (!date) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function buildVerificationLabelData(
  record: SiteCalibration,
  rcPhone?: string | null,
): VerificationLabelData {
  const missingFields: string[] = [];

  const certificateNumber = record.certificateNumber?.trim() || '';
  if (!certificateNumber) {
    missingFields.push('Certificate number');
  }

  const validTill = formatVerificationLabelValidTill(record.certifiedAt);
  if (validTill === '—') {
    missingFields.push('Certification date (for valid till)');
  }

  const verifyUrl = buildDocaCertificateViewUrl(certificateNumber);
  if (!verifyUrl) {
    missingFields.push('DOCA verify URL');
  }

  const rcPhoneDisplay = formatVerificationLabelPhone(rcPhone);
  if (rcPhoneDisplay === '—') {
    missingFields.push('RC phone number');
  }

  return {
    approvalNumber: VERIFICATION_LABEL_BRANDING.gatcApprovalNumber,
    certificateNumber: certificateNumber || '—',
    validTill,
    verifyUrl,
    rcPhoneDisplay,
    rcWhatsAppUrl: buildVerificationLabelWhatsAppUrl(rcPhone),
    missingFields,
  };
}
