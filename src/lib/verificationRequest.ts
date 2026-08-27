import type {
  JobType,
  Product,
  SiteCalibration,
  VerificationPerformedBy,
  VerificationRequestSource,
  VerificationRequestStatus,
  WorkflowMode,
} from '../types';

export const VERIFICATION_REQUEST_STATUSES: VerificationRequestStatus[] = [
  'draft',
  'pending_rc',
  'submitted',
  'approved',
  'certified',
  'rejected',
];

const CORRUPTED_FIRESTORE_MARKER = 'System.Collections.Generic.Dictionary';

export type VerificationStatusSource = Pick<
  SiteCalibration,
  | 'status'
  | 'submittedAt'
  | 'approvedAt'
  | 'certifiedAt'
  | 'certificateNumber'
  | 'certificatePdfUrl'
>;

export function isCorruptedFirestoreString(value: string | undefined): boolean {
  return Boolean(value?.includes(CORRUPTED_FIRESTORE_MARKER));
}

export function isValidVerificationIsoTimestamp(value: string | undefined): value is string {
  if (!value?.trim() || isCorruptedFirestoreString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

/** Infer workflow stage when status/timestamps were corrupted by the certificate worker bug. */
export function inferVerificationStatus(record: VerificationStatusSource): VerificationRequestStatus {
  if (record.certificateNumber?.trim() && !isCorruptedFirestoreString(record.certificateNumber)) {
    return 'certified';
  }
  if (record.certificatePdfUrl?.trim() && !isCorruptedFirestoreString(record.certificatePdfUrl)) {
    return 'certified';
  }
  if (isValidVerificationIsoTimestamp(record.certifiedAt)) {
    return 'certified';
  }
  if (isValidVerificationIsoTimestamp(record.approvedAt)) {
    return 'approved';
  }
  if (isValidVerificationIsoTimestamp(record.submittedAt)) {
    return 'submitted';
  }
  return 'draft';
}

export function normalizeVerificationStatus(
  record: VerificationStatusSource,
): VerificationRequestStatus {
  const raw = record.status;
  if (
    raw === 'submitted' ||
    raw === 'pending_rc' ||
    raw === 'approved' ||
    raw === 'certified' ||
    raw === 'draft' ||
    raw === 'rejected'
  ) {
    return raw;
  }

  if (isCorruptedFirestoreString(raw) || typeof raw === 'string') {
    return inferVerificationStatus(record);
  }

  return 'draft';
}

export function sanitizeVerificationDisplayText(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || isCorruptedFirestoreString(trimmed)) return '—';
  return trimmed;
}

export function verificationCertificateNumber(
  record: Pick<SiteCalibration, 'certificateNumber'>,
): string | undefined {
  const sanitized = sanitizeVerificationDisplayText(record.certificateNumber);
  return sanitized === '—' ? undefined : sanitized;
}

export function firstValidVerificationTimestamp(
  record: Pick<
    SiteCalibration,
    'certifiedAt' | 'approvedAt' | 'submittedAt' | 'createdAt' | 'updatedAt'
  >,
): string | undefined {
  for (const candidate of [
    record.certifiedAt,
    record.approvedAt,
    record.submittedAt,
    record.createdAt,
    record.updatedAt,
  ]) {
    if (isValidVerificationIsoTimestamp(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function isCorruptedVerificationRecord(
  record: Pick<
    SiteCalibration,
    'status' | 'approvedAt' | 'updatedAt' | 'submittedAt' | 'certificateNumber'
  >,
): boolean {
  return (
    isCorruptedFirestoreString(record.status) ||
    isCorruptedFirestoreString(record.approvedAt) ||
    isCorruptedFirestoreString(record.updatedAt) ||
    isCorruptedFirestoreString(record.submittedAt) ||
    isCorruptedFirestoreString(record.certificateNumber)
  );
}

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

export function isVerificationEditable(record: VerificationStatusSource): boolean {
  return normalizeVerificationStatus(record) === 'draft';
}

export function isVerificationViewable(_record: Pick<SiteCalibration, 'status'>): boolean {
  return true;
}

export function canSubmitVerification(record: VerificationStatusSource): boolean {
  return normalizeVerificationStatus(record) === 'draft';
}

export function isVerifierPerformed(
  record: Pick<SiteCalibration, 'performedBy' | 'requestSource'>,
): boolean {
  return record.performedBy === 'verifier' || record.requestSource === 'verifier_manual';
}

export function canRcApproveVerifierVerification(
  record: Pick<SiteCalibration, 'status' | 'performedBy' | 'requestSource'>,
): boolean {
  return normalizeVerificationStatus(record) === 'pending_rc' && isVerifierPerformed(record);
}

export function buildVerifierRcReviewPatch(now = new Date().toISOString()): {
  status: VerificationRequestStatus;
  pendingRcAt: string;
  updatedAt: string;
} {
  return {
    status: 'pending_rc',
    pendingRcAt: now,
    updatedAt: now,
  };
}

export function buildRcApproveVerifierPatch(
  rcUid: string,
  now = new Date().toISOString(),
): {
  rcApprovedAt: string;
  rcApprovedByUid: string;
  updatedAt: string;
} {
  return {
    rcApprovedAt: now,
    rcApprovedByUid: rcUid,
    updatedAt: now,
  };
}

export function hasStoredCertificatePdf(
  record: Pick<SiteCalibration, 'certificatePdfUrl' | 'signedCertificatePdfUrl'>,
): boolean {
  return Boolean(record.certificatePdfUrl?.trim() || record.signedCertificatePdfUrl?.trim());
}

export function canDownloadVerificationCertificate(record: SiteCalibration): boolean {
  const status = normalizeVerificationStatus(record);
  return (
    (status === 'approved' || status === 'certified') &&
    hasStoredCertificatePdf(record)
  );
}

export function canDeleteVerification(record: VerificationStatusSource): boolean {
  return normalizeVerificationStatus(record) === 'draft';
}

export type VerificationFilterStatus =
  | VerificationRequestStatus
  | 'failed_submit'
  | 'failed_certification'
  | 'rejected';

export type VerificationStatusFilter = VerificationFilterStatus | 'all' | 'duplicates';

export type VerificationTypeFilter = 'all' | JobType;

export interface VerificationTypeFilterCounts {
  all: number;
  OV: number;
  RV: number;
}

export interface VerificationStatusFilterCounts {
  all: number;
  draft: number;
  pending_rc: number;
  submitted: number;
  approved: number;
  certified: number;
  failed_submit: number;
  failed_certification: number;
  rejected: number;
  duplicates: number;
}

export function isVerificationFullyCertified(record: SiteCalibration): boolean {
  return (
    normalizeVerificationStatus(record) === 'certified' &&
    Boolean(record.certificateNumber?.trim()) &&
    hasStoredCertificatePdf(record)
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
  if (isVerificationRejected(record)) return false;
  if (record.certificateQuality === 'certification_failed') return true;
  if (record.pipelineFailedPhase === 'certification') return true;
  if (isVerificationStuckAtApproved(record)) return true;
  const status = normalizeVerificationStatus(record);
  if (status === 'certified') {
    return !verificationCertificateNumber(record);
  }
  return false;
}

/** Approved in Firebase but eMAAP PDF download never finished (worker retries exhausted). */
export function isVerificationStuckAtApproved(record: SiteCalibration): boolean {
  if (isVerificationRejected(record)) return false;
  if (normalizeVerificationStatus(record) !== 'approved') return false;
  if (canDownloadVerificationCertificate(record)) return false;
  if (record.certificateNumber?.trim()) return false;

  return (
    record.pipelineFailedPhase === 'certification' ||
    Boolean(record.certificationLastError?.trim()) ||
    Boolean(record.pipelineFailureMessage?.trim())
  );
}

export function isVerificationRejected(record: VerificationStatusSource): boolean {
  return record.status === 'rejected';
}

/** Incomplete certification — eligible for Super Admin eMAAP resubmit. */
export function isCertificationFailureResubmitSource(record: SiteCalibration): boolean {
  if (isVerificationRejected(record)) return false;
  if (isVerificationFullyCertified(record) || canDownloadVerificationCertificate(record)) {
    return false;
  }
  return isVerificationFailedAtCertification(record);
}

/** True when Firestore is certified and eMAAP issued a certificate number. */
export function isVerificationCertifiedOnDoca(record: SiteCalibration): boolean {
  return (
    normalizeVerificationStatus(record) === 'certified' &&
    Boolean(record.certificateNumber?.trim())
  );
}

export function getVerificationDisplayStatus(record: SiteCalibration): VerificationFilterStatus {
  if (isVerificationRejected(record)) return 'rejected';
  if (isVerificationFailedAtSubmit(record)) return 'failed_submit';
  if (isVerificationFailedAtCertification(record)) return 'failed_certification';
  return normalizeVerificationStatus(record);
}

export function verificationFilterLabel(filter: VerificationStatusFilter): string {
  if (filter === 'all') return 'All stages';
  if (filter === 'failed_submit') return 'Failed at submit';
  if (filter === 'failed_certification') return 'Failed at certification';
  if (filter === 'rejected') return 'Rejected';
  if (filter === 'duplicates') return 'Duplicates';
  return verificationStatusLabel(filter);
}

export function verificationDisplayStatusLabel(record: SiteCalibration): string {
  return verificationFilterLabel(getVerificationDisplayStatus(record));
}

export function verificationDisplayStatusTitle(record: SiteCalibration): string | undefined {
  if (isVerificationCertifiedOnDoca(record) && !hasStoredCertificatePdf(record)) {
    return 'Certificate issued — eMAAP PDF is not stored in Firebase yet.';
  }
  if (
    normalizeVerificationStatus(record) === 'certified'
    && !verificationCertificateNumber(record)
    && isValidVerificationIsoTimestamp(record.certifiedAt)
  ) {
    return 'Certified in Firebase but certificate number not synced — use Pipeline recovery to restore submitted so the eMAAP worker reprocesses it.';
  }
  const display = getVerificationDisplayStatus(record);
  if (display === 'failed_submit' || display === 'failed_certification') {
    return record.pipelineFailureMessage?.trim() || verificationDisplayStatusLabel(record);
  }
  if (
    display === 'draft' ||
    display === 'pending_rc' ||
    display === 'submitted' ||
    display === 'approved' ||
    display === 'certified' ||
    display === 'rejected'
  ) {
    return verificationStatusDescription(display);
  }
  return verificationDisplayStatusLabel(record);
}

/** Mutually exclusive stage bucket for one record (matches tally + list filter). */
export function verificationStatusFilterBucket(
  record: SiteCalibration,
): Exclude<VerificationStatusFilter, 'all' | 'duplicates'> {
  if (isVerificationRejected(record)) return 'rejected';
  if (isVerificationFailedAtSubmit(record)) return 'failed_submit';
  if (isVerificationFullyCertified(record)) return 'certified';
  const status = normalizeVerificationStatus(record);
  if (status === 'draft') return 'draft';
  if (status === 'pending_rc') return 'pending_rc';
  // Submitted queue (incl. legacy approved / incomplete certified awaiting repair).
  if (status === 'submitted' || status === 'approved' || status === 'certified') {
    return 'submitted';
  }
  return 'draft';
}

export function matchesVerificationStatusFilter(
  record: SiteCalibration,
  filter: VerificationStatusFilter,
): boolean {
  if (filter === 'duplicates') return false;
  if (filter === 'all') return true;
  if (filter === 'failed_submit') return isVerificationFailedAtSubmit(record);
  if (filter === 'failed_certification') return isVerificationFailedAtCertification(record);
  if (filter === 'rejected') return isVerificationRejected(record);
  if (filter === 'certified') return isVerificationFullyCertified(record);
  if (filter === 'submitted') {
    return verificationStatusFilterBucket(record) === 'submitted';
  }
  if (filter === 'approved') {
    return verificationStatusFilterBucket(record) === 'submitted';
  }
  return normalizeVerificationStatus(record) === filter;
}

export function matchesVerificationTypeFilter(
  record: SiteCalibration,
  filter: VerificationTypeFilter,
): boolean {
  if (filter === 'all') return true;
  return record.verificationType === filter;
}

export function tallyVerificationTypeFilters(
  records: SiteCalibration[],
): VerificationTypeFilterCounts {
  const tally: VerificationTypeFilterCounts = { all: records.length, OV: 0, RV: 0 };
  for (const record of records) {
    if (record.verificationType === 'RV') {
      tally.RV += 1;
    } else {
      tally.OV += 1;
    }
  }
  return tally;
}

export function buildVerificationTypeFilterOptions(
  counts: VerificationTypeFilterCounts,
): { value: VerificationTypeFilter; label: string; count: number }[] {
  return [
    { value: 'all', label: 'OV+RV', count: counts.all },
    { value: 'OV', label: 'OV', count: counts.OV },
    { value: 'RV', label: 'RV', count: counts.RV },
  ];
}

export function tallyVerificationStatusFilters(
  records: SiteCalibration[],
): VerificationStatusFilterCounts {
  const tally: VerificationStatusFilterCounts = {
    all: records.length,
    draft: 0,
    pending_rc: 0,
    submitted: 0,
    approved: 0,
    certified: 0,
    failed_submit: 0,
    failed_certification: 0,
    rejected: 0,
    duplicates: 0,
  };

  for (const record of records) {
    tally[verificationStatusFilterBucket(record)] += 1;
  }

  return tally;
}

export function buildVerificationStatusFilterOptions(
  counts: VerificationStatusFilterCounts,
): { value: VerificationStatusFilter; label: string; count: number }[] {
  return [
    { value: 'all', label: 'All stages', count: counts.all },
    { value: 'draft', label: 'Draft', count: counts.draft },
    { value: 'pending_rc', label: 'Pending RC', count: counts.pending_rc },
    { value: 'submitted', label: 'Submitted', count: counts.submitted },
    { value: 'certified', label: 'Certified', count: counts.certified },
    { value: 'failed_submit', label: 'Failed at submit', count: counts.failed_submit },
    { value: 'rejected', label: 'Rejected', count: counts.rejected },
  ];
}

export function verificationStatusLabel(status: VerificationRequestStatus): string {
  if (status === 'draft') return 'Draft';
  if (status === 'pending_rc') return 'Pending RC';
  if (status === 'submitted') return 'Submitted';
  if (status === 'certified') return 'Certified';
  if (status === 'rejected') return 'Rejected';
  return 'Approved';
}

export function verificationStatusDescription(status: VerificationRequestStatus): string {
  if (status === 'draft') return 'Open and edit before submitting for certificate generation.';
  if (status === 'pending_rc') return 'Sent to RC Admin — approve to start certificate generation.';
  if (status === 'submitted') return 'Locked — awaiting eMAAP certificate generation.';
  if (status === 'certified') return 'Certificate issued and stored in Firebase.';
  if (status === 'rejected') return 'Certification failed — closed; not retried by the worker.';
  return 'Legacy mid-state — eMAAP worker treats this like submitted once reset.';
}

export function verificationVctLabel(
  record: SiteCalibration,
  options?: { rcContactPerson?: string | null },
): string {
  if (record.performedBy === 'verifier' || record.requestSource === 'verifier_manual') {
    return record.vctName?.trim() || record.vctId || 'Verifier';
  }
  if (record.performedBy === 'vct' || record.vctId?.trim()) {
    return record.vctName?.trim() || record.vctId || 'VCT';
  }
  return (
    record.vctName?.trim()
    || options?.rcContactPerson?.trim()
    || 'Self'
  );
}

export function productSnapshotFromProduct(
  product: Product | null | undefined,
): Pick<
  SiteCalibration,
  | 'maximumCapacity'
  | 'verificationScaleInterval'
  | 'unitOfMeasurement'
  | 'manufacturerBrandSeries'
  | 'modelApprovalNo'
  | 'accuracyClass'
> {
  if (!product) return {};
  return {
    maximumCapacity: product.maximumCapacity,
    verificationScaleInterval: product.verificationScaleInterval,
    unitOfMeasurement: product.unitOfMeasurement,
    ...(product.manufacturerBrandSeries?.trim()
      ? { manufacturerBrandSeries: product.manufacturerBrandSeries.trim() }
      : {}),
    ...(product.modelApprovalNo?.trim()
      ? { modelApprovalNo: product.modelApprovalNo.trim() }
      : {}),
    ...(product.accuracyClass?.trim() ? { accuracyClass: product.accuracyClass.trim() } : {}),
  };
}

export function formatVerificationCapAcc(record: SiteCalibration): string {
  const cap = record.maximumCapacity;
  const interval = record.verificationScaleInterval;
  if (cap == null || interval == null) return '—';
  const unit = record.unitOfMeasurement || 'kg';
  return `${cap} ${unit} / ${interval} g`;
}

export function buildRcDirectVerificationMeta(contactPerson?: string): {
  status: VerificationRequestStatus;
  performedBy: VerificationPerformedBy;
  requestSource: VerificationRequestSource;
  vctName?: string;
} {
  const name = contactPerson?.trim();
  return {
    status: 'draft',
    performedBy: 'rc',
    requestSource: 'rc_direct',
    ...(name ? { vctName: name } : {}),
  };
}

export type VerificationDraftActorMeta =
  | { actor: 'rc'; contactPerson?: string }
  | { actor: 'vct'; vctId: string; vctName: string; workflowMode?: WorkflowMode }
  | { actor: 'verifier'; verifierId: string; verifierName: string };

export function buildVerificationDraftMeta(
  actor: VerificationDraftActorMeta,
): Pick<SiteCalibration, 'status' | 'performedBy' | 'requestSource' | 'vctId' | 'vctName'> {
  if (actor.actor === 'rc') {
    return buildRcDirectVerificationMeta(actor.contactPerson);
  }

  if (actor.actor === 'verifier') {
    return {
      status: 'draft',
      performedBy: 'verifier',
      requestSource: 'verifier_manual',
      vctId: actor.verifierId,
      vctName: actor.verifierName.trim() || 'Verifier',
    };
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
  isVerifier?: boolean;
  actorUid: string | null;
  actorUsername?: string;
  actorWorkflowMode?: WorkflowMode;
  rcContactPerson?: string;
}): VerificationDraftActorMeta {
  if (params.isVerifier && params.actorUid) {
    return {
      actor: 'verifier',
      verifierId: params.actorUid,
      verifierName: params.actorUsername?.trim() || 'Verifier',
    };
  }

  if (!params.isVct || !params.actorUid) {
    return { actor: 'rc', contactPerson: params.rcContactPerson };
  }

  return {
    actor: 'vct',
    vctId: params.actorUid,
    vctName: params.actorUsername?.trim() || 'VCT',
    workflowMode: params.actorWorkflowMode ?? 'auto',
  };
}

export type AssignableVctOption = {
  uid: string;
  username: string;
  workflowMode?: WorkflowMode;
};

/** RC admin may assign a draft to a VCT; VCT sessions always use the signed-in technician. */
export function resolveVerificationDraftActorForSession(
  assignedVctId: string | undefined,
  params: {
    isVct: boolean;
    isVerifier?: boolean;
    actorUid: string | null;
    actorUsername?: string;
    actorWorkflowMode?: WorkflowMode;
    assignableVcts?: AssignableVctOption[];
    rcContactPerson?: string;
  },
): VerificationDraftActorMeta {
  if (params.isVerifier) {
    return resolveVerificationDraftActorMeta({
      isVerifier: true,
      isVct: false,
      actorUid: params.actorUid,
      actorUsername: params.actorUsername,
    });
  }

  if (params.isVct) {
    return resolveVerificationDraftActorMeta({
      isVct: true,
      actorUid: params.actorUid,
      actorUsername: params.actorUsername,
      actorWorkflowMode: params.actorWorkflowMode,
    });
  }

  const vctId = assignedVctId?.trim();
  if (vctId && params.assignableVcts?.length) {
    const vct = params.assignableVcts.find(entry => entry.uid === vctId);
    if (vct) {
      return {
        actor: 'vct',
        vctId: vct.uid,
        vctName: vct.username.trim() || 'VCT',
        workflowMode: vct.workflowMode,
      };
    }
  }

  return { actor: 'rc', contactPerson: params.rcContactPerson };
}

export function verificationPerformerCreatedByUid(
  actor: VerificationDraftActorMeta,
  rcAdminUid: string | null,
): string | undefined {
  return actor.actor === 'vct'
    ? actor.vctId
    : actor.actor === 'verifier'
      ? actor.verifierId
      : rcAdminUid ?? undefined;
}

export function shouldClearVerificationVctFields(
  actor: VerificationDraftActorMeta,
  previousRecord?: Pick<SiteCalibration, 'vctId' | 'performedBy'> | null,
): boolean {
  return actor.actor === 'rc' && Boolean(previousRecord?.vctId || previousRecord?.performedBy === 'vct' || previousRecord?.performedBy === 'verifier');
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
