import { inferVerificationSubject, verificationLocationLabel } from './siteCalibrationProfileFields';
import { sanitizeVerificationDisplayText } from './verificationRequest';
import type { VerificationSubmitProgressStage } from './verificationSubmitProgressStages';
import type { Customer, SiteCalibration } from '../types';

export type VerificationProgressDetailRow = {
  id: string;
  label: string;
  value: string;
};

function displayValue(value: string | undefined | null): string {
  return sanitizeVerificationDisplayText(value ?? undefined);
}

export function formatVerificationProgressCapacity(record: SiteCalibration): string {
  const cap = record.maximumCapacity;
  if (cap == null || !Number.isFinite(cap)) return '—';
  const unit = record.unitOfMeasurement || 'kg';
  return `${cap} ${unit}`;
}

export function formatVerificationProgressLocation(
  record: SiteCalibration,
  customer?: Customer | null,
): string {
  if (customer) {
    const place = [customer.district, customer.state].filter(part => part?.trim()).join(', ');
    if (place) {
      return record.customerName?.trim()
        ? `${record.customerName.trim()}, ${place}`
        : place;
    }
    if (customer.address?.trim()) {
      return record.customerName?.trim()
        ? `${record.customerName.trim()}, ${customer.address.trim()}`
        : customer.address.trim();
    }
  }

  const locationType = verificationLocationLabel(record.verificationLocation);
  if (inferVerificationSubject(record) === 'self') {
    return locationType !== '—' ? locationType : 'RC centre';
  }

  if (record.customerName?.trim() && locationType !== '—') {
    return `${record.customerName.trim()} · ${locationType}`;
  }

  return displayValue(record.customerName) !== '—' ? record.customerName!.trim() : locationType;
}

export function formatVerificationProgressDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function formatVerificationProgressTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

export function formatVerificationProgressDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

/** One-year validity from certification date (display only until stored on record). */
export function formatVerificationProgressValidUpto(certifiedAt?: string): string {
  if (!certifiedAt) return '—';
  try {
    const date = new Date(certifiedAt);
    date.setFullYear(date.getFullYear() + 1);
    date.setDate(date.getDate() - 1);
    return formatVerificationProgressDate(date.toISOString());
  } catch {
    return '—';
  }
}

export function buildVerificationSubmitProgressDetails(
  stage: VerificationSubmitProgressStage,
  record: SiteCalibration,
  customer?: Customer | null,
): VerificationProgressDetailRow[] {
  const applicationNumber = displayValue(record.applicationNumber);
  const certificateNumber = displayValue(record.certificateNumber);
  const submittedAt = record.submittedAt || record.createdAt;

  if (stage === 'submitted') {
    return [
      { id: 'application', label: 'Application Number', value: applicationNumber },
      { id: 'capacity', label: 'Capacity', value: formatVerificationProgressCapacity(record) },
      { id: 'customer', label: 'Customer Name', value: displayValue(record.customerName) },
      { id: 'location', label: 'Location', value: formatVerificationProgressLocation(record, customer) },
      { id: 'submitted-date', label: 'Submitted Date', value: formatVerificationProgressDate(submittedAt) },
      { id: 'submitted-time', label: 'Submitted Time', value: formatVerificationProgressTime(submittedAt) },
    ];
  }

  if (stage === 'approved') {
    const rows: VerificationProgressDetailRow[] = [
      { id: 'application', label: 'Application No.', value: applicationNumber },
      { id: 'instrument', label: 'Instrument', value: displayValue(record.productName) },
      { id: 'capacity', label: 'Capacity', value: formatVerificationProgressCapacity(record) },
      { id: 'location', label: 'Location', value: formatVerificationProgressLocation(record, customer) },
    ];

    if (certificateNumber !== '—') {
      rows.push({ id: 'certificate', label: 'Certificate No.', value: certificateNumber });
    }

    rows.push({
      id: 'approved-on',
      label: 'Approved On',
      value: formatVerificationProgressDateTime(record.approvedAt),
    });

    return rows;
  }

  const rows: VerificationProgressDetailRow[] = [];

  if (certificateNumber !== '—') {
    rows.push({ id: 'certificate', label: 'Certificate No.', value: certificateNumber });
  }

  rows.push(
    { id: 'application', label: 'Application No.', value: applicationNumber },
    { id: 'instrument', label: 'Instrument', value: displayValue(record.productName) },
    { id: 'capacity', label: 'Capacity', value: formatVerificationProgressCapacity(record) },
    { id: 'client', label: 'Client', value: displayValue(record.customerName) },
    {
      id: 'verified-on',
      label: 'Date of Verification',
      value: formatVerificationProgressDate(record.certifiedAt || record.approvedAt || submittedAt),
    },
    {
      id: 'valid-upto',
      label: 'Valid Upto',
      value: formatVerificationProgressValidUpto(record.certifiedAt),
    },
  );

  return rows;
}

export function verificationSubmitProgressFooterMessage(
  stage: VerificationSubmitProgressStage,
): string | null {
  if (stage === 'submitted') {
    return 'We will review your application and update you shortly.';
  }
  if (stage === 'certified') {
    return 'VERIFICATION SUCCESSFUL';
  }
  return null;
}
