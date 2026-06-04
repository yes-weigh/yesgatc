import type {
  Product,
  SiteCalibration,
  VerificationPerformedBy,
  VerificationRequestSource,
  VerificationRequestStatus,
  WorkflowMode,
} from '../types';

export const VERIFICATION_REQUEST_STATUSES: VerificationRequestStatus[] = [
  'draft',
  'submitted',
  'approved',
  'certified',
];

/** Fields only the certificate server should write (Firebase Admin SDK). */
export const VERIFICATION_SERVER_MANAGED_FIELDS = [
  'status',
  'approvedAt',
  'certifiedAt',
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
  if (
    record.status === 'submitted' ||
    record.status === 'approved' ||
    record.status === 'certified' ||
    record.status === 'draft'
  ) {
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
  const status = normalizeVerificationStatus(record);
  return (
    (status === 'approved' || status === 'certified') &&
    Boolean(record.certificatePdfUrl?.trim())
  );
}

export function canDeleteVerification(record: Pick<SiteCalibration, 'status'>): boolean {
  return normalizeVerificationStatus(record) === 'draft';
}

export type VerificationFilterStatus =
  | VerificationRequestStatus
  | 'failed_submit'
  | 'failed_certification';

export type VerificationStatusFilter = VerificationFilterStatus | 'all';

export interface VerificationStatusFilterCounts {
  all: number;
  draft: number;
  submitted: number;
  approved: number;
  certified: number;
  failed_submit: number;
  failed_certification: number;
}

export function isVerificationFullyCertified(record: SiteCalibration): boolean {
  return (
    normalizeVerificationStatus(record) === 'certified' &&
    Boolean(record.certificateNumber?.trim()) &&
    Boolean(record.certificatePdfUrl?.trim())
  );
}

/** Completed verification with a certificate number — show document action tiles. */
export function canShowVerificationCertifiedActions(record: SiteCalibration): boolean {
  if (!record.certificateNumber?.trim()) return false;
  return isVerificationFullyCertified(record) || canDownloadVerificationCertificate(record);
}

export function isVerificationFailedAtSubmit(record: SiteCalibration): boolean {
  if (normalizeVerificationStatus(record) !== 'submitted') return false;
  return record.pipelineFailedPhase === 'submit';
}

export function isVerificationFailedAtCertification(record: SiteCalibration): boolean {
  if (record.pipelineFailedPhase === 'certification') return true;
  const status = normalizeVerificationStatus(record);
  if (status === 'certified') {
    return !record.certificateNumber?.trim() || !record.certificatePdfUrl?.trim();
  }
  return false;
}

export function getVerificationDisplayStatus(record: SiteCalibration): VerificationFilterStatus {
  if (isVerificationFailedAtSubmit(record)) return 'failed_submit';
  if (isVerificationFailedAtCertification(record)) return 'failed_certification';
  return normalizeVerificationStatus(record);
}

export function verificationFilterLabel(filter: VerificationStatusFilter): string {
  if (filter === 'all') return 'All';
  if (filter === 'failed_submit') return 'Failed at submit';
  if (filter === 'failed_certification') return 'Failed at certification';
  return verificationStatusLabel(filter);
}

export function verificationDisplayStatusLabel(record: SiteCalibration): string {
  return verificationFilterLabel(getVerificationDisplayStatus(record));
}

export function matchesVerificationStatusFilter(
  record: SiteCalibration,
  filter: VerificationStatusFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'failed_submit') return isVerificationFailedAtSubmit(record);
  if (filter === 'failed_certification') return isVerificationFailedAtCertification(record);
  if (filter === 'certified') return isVerificationFullyCertified(record);
  if (filter === 'submitted') {
    return normalizeVerificationStatus(record) === 'submitted' && !isVerificationFailedAtSubmit(record);
  }
  return normalizeVerificationStatus(record) === filter;
}

export function tallyVerificationStatusFilters(
  records: SiteCalibration[],
): VerificationStatusFilterCounts {
  const tally: VerificationStatusFilterCounts = {
    all: records.length,
    draft: 0,
    submitted: 0,
    approved: 0,
    certified: 0,
    failed_submit: 0,
    failed_certification: 0,
  };

  for (const record of records) {
    if (isVerificationFailedAtSubmit(record)) {
      tally.failed_submit += 1;
      continue;
    }
    if (isVerificationFailedAtCertification(record)) {
      tally.failed_certification += 1;
      continue;
    }
    const status = normalizeVerificationStatus(record);
    if (status === 'certified') {
      tally.certified += 1;
    } else {
      tally[status] += 1;
    }
  }

  return tally;
}

export function buildVerificationStatusFilterOptions(
  counts: VerificationStatusFilterCounts,
): { value: VerificationStatusFilter; label: string; count: number }[] {
  return [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'draft', label: 'Draft', count: counts.draft },
    { value: 'submitted', label: 'Submitted', count: counts.submitted },
    { value: 'approved', label: 'Approved', count: counts.approved },
    { value: 'certified', label: 'Certified', count: counts.certified },
    { value: 'failed_submit', label: 'Failed at submit', count: counts.failed_submit },
    {
      value: 'failed_certification',
      label: 'Failed at certification',
      count: counts.failed_certification,
    },
  ];
}

export function verificationStatusLabel(status: VerificationRequestStatus): string {
  if (status === 'draft') return 'Draft';
  if (status === 'submitted') return 'Submitted';
  if (status === 'certified') return 'Certified';
  return 'Approved';
}

export function verificationStatusDescription(status: VerificationRequestStatus): string {
  if (status === 'draft') return 'Open and edit before submitting for certificate generation.';
  if (status === 'submitted') return 'Locked — awaiting certificate server processing.';
  if (status === 'certified') return 'Signed certificate uploaded to DOCA.';
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

export type VerificationDraftActorMeta =
  | { actor: 'rc' }
  | { actor: 'vct'; vctId: string; vctName: string; workflowMode?: WorkflowMode };

export function buildVerificationDraftMeta(
  actor: VerificationDraftActorMeta,
): Pick<SiteCalibration, 'status' | 'performedBy' | 'requestSource' | 'vctId' | 'vctName'> {
  if (actor.actor === 'rc') {
    return buildRcDirectVerificationMeta();
  }

  return {
    status: 'draft',
    performedBy: 'vct',
    requestSource: actor.workflowMode === 'manual' ? 'vct_manual' : 'vct_auto',
    vctId: actor.vctId,
    vctName: actor.vctName.trim() || 'VCT',
  };
}

export function resolveVerificationDraftActorMeta(params: {
  isVct: boolean;
  actorUid: string | null;
  actorUsername?: string;
  actorWorkflowMode?: WorkflowMode;
}): VerificationDraftActorMeta {
  if (!params.isVct || !params.actorUid) {
    return { actor: 'rc' };
  }

  return {
    actor: 'vct',
    vctId: params.actorUid,
    vctName: params.actorUsername?.trim() || 'VCT',
    workflowMode: params.actorWorkflowMode ?? 'auto',
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
