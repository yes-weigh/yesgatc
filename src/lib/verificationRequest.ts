import type {
  Product,
  SiteCalibration,
  VerificationPerformedBy,
  VerificationRequestSource,
  VerificationRequestStatus,
} from '../types';

export const VERIFICATION_REQUEST_STATUSES: VerificationRequestStatus[] = [
  'draft',
  'submitted',
  'approved',
];

/** Fields only the certificate server should write (Firebase Admin SDK). */
export const VERIFICATION_SERVER_MANAGED_FIELDS = [
  'status',
  'approvedAt',
  'certificateNumber',
  'certificatePdfUrl',
  'certificatePdfPath',
  'certificatePdfName',
  'certificatePdfContentType',
] as const;

export type VerificationApprovalPayload = {
  status: 'approved';
  approvedAt: string;
  certificateNumber: string;
  certificatePdfUrl: string;
  certificatePdfPath: string;
  certificatePdfName: string;
  certificatePdfContentType: string;
};

export function normalizeVerificationStatus(
  record: Pick<SiteCalibration, 'status'>,
): VerificationRequestStatus {
  if (record.status === 'submitted' || record.status === 'approved' || record.status === 'draft') {
    return record.status;
  }
  return 'draft';
}

export function isVerificationEditable(record: Pick<SiteCalibration, 'status'>): boolean {
  return normalizeVerificationStatus(record) === 'draft';
}

export function isVerificationViewable(_record: Pick<SiteCalibration, 'status'>): boolean {
  return true;
}

export function canSubmitVerification(record: Pick<SiteCalibration, 'status'>): boolean {
  return normalizeVerificationStatus(record) === 'draft';
}

export function canDownloadVerificationCertificate(record: SiteCalibration): boolean {
  return (
    normalizeVerificationStatus(record) === 'approved' &&
    Boolean(record.certificatePdfUrl?.trim())
  );
}

export function canDeleteVerification(record: Pick<SiteCalibration, 'status'>): boolean {
  return normalizeVerificationStatus(record) === 'draft';
}

/** Super Admin — interim until certificate server owns the submitted queue. */
export function canAdminDeleteVerification(record: Pick<SiteCalibration, 'status'>): boolean {
  const status = normalizeVerificationStatus(record);
  return status === 'submitted' || status === 'approved';
}

export function verificationStatusLabel(status: VerificationRequestStatus): string {
  if (status === 'draft') return 'Draft';
  if (status === 'submitted') return 'Submitted';
  return 'Approved';
}

export function verificationStatusDescription(status: VerificationRequestStatus): string {
  if (status === 'draft') return 'Open and edit before submitting for certificate generation.';
  if (status === 'submitted') return 'Locked — awaiting certificate server processing.';
  return 'Certificate generated and ready to download.';
}

export function verificationVctLabel(record: SiteCalibration): string {
  if (record.performedBy === 'vct' || record.vctId || record.vctName?.trim()) {
    return record.vctName?.trim() || record.vctId || 'VCT';
  }
  return 'Self';
}

export function productSnapshotFromProduct(
  product: Product | null | undefined,
): Pick<SiteCalibration, 'maximumCapacity' | 'verificationScaleInterval' | 'unitOfMeasurement'> {
  if (!product) return {};
  return {
    maximumCapacity: product.maximumCapacity,
    verificationScaleInterval: product.verificationScaleInterval,
    unitOfMeasurement: product.unitOfMeasurement,
  };
}

export function formatVerificationCapAcc(record: SiteCalibration): string {
  const cap = record.maximumCapacity;
  const interval = record.verificationScaleInterval;
  if (cap == null || interval == null) return '—';
  const unit = record.unitOfMeasurement || 'kg';
  return `${cap} ${unit} / ${interval} g`;
}

export function buildRcDirectVerificationMeta(): {
  status: VerificationRequestStatus;
  performedBy: VerificationPerformedBy;
  requestSource: VerificationRequestSource;
} {
  return {
    status: 'draft',
    performedBy: 'rc',
    requestSource: 'rc_direct',
  };
}

export function buildVerificationSubmitPatch(now = new Date().toISOString()): {
  status: VerificationRequestStatus;
  submittedAt: string;
  updatedAt: string;
} {
  return {
    status: 'submitted',
    submittedAt: now,
    updatedAt: now,
  };
}

/**
 * Certificate server contract — apply via Admin SDK when processing `submitted` requests.
 * Query: siteCalibrations where status == 'submitted'
 * Sources: rc_direct, vct_manual (RC-approved jobs), vct_auto (auto-approval workflow)
 */
export function buildVerificationApprovalPatch(
  payload: Omit<VerificationApprovalPayload, 'status'>,
): VerificationApprovalPayload {
  return {
    status: 'approved',
    ...payload,
  };
}
