import { collection, doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { isRvWalletPaymentRequired } from './appSettings';
import { allocateVerificationApplicationNumber } from './verificationApplicationNumber';
import { isActiveRvWalletPayment } from './rcWallet';
import { buildRvPaymentFirestorePatch } from './rvPaymentAmount';
import {
  canDownloadVerificationCertificate,
  isVerificationCertifiedOnDoca,
  isVerificationFullyCertified,
  isCertificationFailureResubmitSource,
  isVerificationRejected,
  normalizeVerificationStatus,
} from './verificationRequest';
import {
  canVoidVerificationCertificate,
  isVerificationCertificateVoided,
  voidVerificationCertificate,
} from './verificationCertificateVoid';
import type { SiteCalibration } from '../types';

/** Original record marked when Super Admin queues a DOCA resubmission. */
export type CertificateQuality = 'corrupted_qr' | 'certification_failed';

const CERTIFICATE_OUTCOME_FIELDS = [
  'approvedAt',
  'certifiedAt',
  'certificateNumber',
  'certificatePdfUrl',
  'certificatePdfPath',
  'certificatePdfName',
  'certificatePdfContentType',
  'emaapCertificatePdfUrl',
  'pipelineFailedPhase',
  'pipelineFailureMessage',
  'pipelineFailedAt',
  'certificationLastError',
  'supersededByResubmissionId',
] as const;

export function normalizeSerialKey(serial?: string): string {
  return serial?.trim().toLowerCase() ?? '';
}

/** All verification documents for the same RC + serial (oldest first). */
export function getVerificationSerialGroup(
  allRecords: SiteCalibration[],
  record: SiteCalibration,
): SiteCalibration[] {
  const serialKey = normalizeSerialKey(record.serialNumber);
  const rcId = record.rcId?.trim();
  if (!serialKey || !rcId) {
    return [record];
  }

  return allRecords
    .filter(
      r => r.rcId?.trim() === rcId && normalizeSerialKey(r.serialNumber) === serialKey,
    )
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export function isCorruptedCertificateRecord(record: SiteCalibration): boolean {
  return record.certificateQuality === 'corrupted_qr';
}

export function isCertificationFailedRecord(record: SiteCalibration): boolean {
  return record.certificateQuality === 'certification_failed';
}

export function hasPendingResubmission(
  sourceId: string,
  group: SiteCalibration[],
): boolean {
  return group.some(record => {
    if (record.resubmittedFromId !== sourceId) return false;
    const status = normalizeVerificationStatus(record);
    return status === 'submitted' || status === 'approved';
  });
}

/** True when any resubmission clone for this serial is still in the pipeline. */
export function hasPendingResubmissionInGroup(group: SiteCalibration[]): boolean {
  return group.some(record => {
    if (!record.resubmittedFromId?.trim()) return false;
    const status = normalizeVerificationStatus(record);
    return status === 'submitted' || status === 'approved';
  });
}

function certificateSortKey(record: SiteCalibration): string {
  return record.certifiedAt || record.approvedAt || record.createdAt || '';
}

/** Prefer the opened record when eligible; otherwise the latest certified copy. */
export function pickResubmitSourceForSerialGroup(
  group: SiteCalibration[],
  preferred?: SiteCalibration,
): SiteCalibration | null {
  const eligible = group.filter(r => canResubmitVerification(r, group));
  if (eligible.length === 0) return null;

  if (preferred && eligible.some(r => r.id === preferred.id)) {
    return preferred;
  }

  return [...eligible].sort((a, b) => certificateSortKey(b).localeCompare(certificateSortKey(a)))[0];
}

export function canResubmitSerialGroup(
  group: SiteCalibration[],
  preferred?: SiteCalibration,
): boolean {
  if (hasPendingResubmissionInGroup(group)) return false;
  return pickResubmitSourceForSerialGroup(group, preferred) !== null;
}

export function countVoidableCertificatesInGroup(
  group: SiteCalibration[],
  exceptId: string,
): number {
  return group.filter(r => r.id !== exceptId && canVoidVerificationCertificate(r)).length;
}

/** Super Admin may queue a fresh DOCA run from a completed verification. */
export function canResubmitVerification(
  record: SiteCalibration,
  group: SiteCalibration[],
): boolean {
  if (isVerificationCertificateVoided(record)) return false;
  if (record.supersededByResubmissionId?.trim()) return false;
  if (hasPendingResubmission(record.id, group)) return false;

  if (isCertificationFailureResubmitSource(record)) return true;

  const status = normalizeVerificationStatus(record);
  if (status !== 'certified' && status !== 'approved') return false;

  return (
    isVerificationCertifiedOnDoca(record) ||
    canDownloadVerificationCertificate(record) ||
    isVerificationFullyCertified(record)
  );
}

export function verificationVersionTitle(
  record: SiteCalibration,
  group: SiteCalibration[],
): string {
  if (isVerificationCertificateVoided(record)) {
    return 'Void certificate';
  }

  if (isCorruptedCertificateRecord(record)) {
    return 'Corrupted certificate';
  }

  if (record.resubmittedFromId) {
    const status = normalizeVerificationStatus(record);
    if (status === 'submitted' || status === 'approved') {
      return 'Resubmission in progress';
    }
    if (status === 'certified' || canDownloadVerificationCertificate(record)) {
      return 'Correct certificate';
    }
  }

  if (
    isCertificationFailedRecord(record)
    || isCertificationFailureResubmitSource(record)
    || (record.supersededByResubmissionId?.trim()
      && normalizeVerificationStatus(record) === 'approved'
      && !canDownloadVerificationCertificate(record))
  ) {
    return 'Certification failed';
  }

  if (group.length > 1 && !isCorruptedCertificateRecord(record)) {
    const status = normalizeVerificationStatus(record);
    if (status === 'certified' || canDownloadVerificationCertificate(record)) {
      return 'Correct certificate';
    }
  }

  return 'Verification';
}

/** Lower rank = shown higher in the serial group list. */
export function verificationVersionDisplayRank(
  record: SiteCalibration,
  group: SiteCalibration[],
): number {
  switch (verificationVersionTitle(record, group)) {
    case 'Correct certificate':
      return 0;
    case 'Resubmission in progress':
      return 1;
    case 'Verification':
      return 2;
    case 'Corrupted certificate':
      return 3;
    case 'Certification failed':
      return 3;
    case 'Void certificate':
      return 4;
    default:
      return 2;
  }
}

/** Active certificates first; void and corrupted copies at the bottom. */
export function sortVerificationSerialGroupForDisplay(group: SiteCalibration[]): SiteCalibration[] {
  return [...group].sort((a, b) => {
    const rankDiff =
      verificationVersionDisplayRank(a, group) - verificationVersionDisplayRank(b, group);
    if (rankDiff !== 0) return rankDiff;

    const aKey = certificateSortKey(a);
    const bKey = certificateSortKey(b);
    const rank = verificationVersionDisplayRank(a, group);
    if (rank <= 1) return bKey.localeCompare(aKey);
    return aKey.localeCompare(bKey);
  });
}

export function verificationVersionSubtitle(record: SiteCalibration): string {
  const parts: string[] = [];
  if (record.applicationNumber?.trim()) {
    parts.push(`App ${record.applicationNumber.trim()}`);
  }
  if (record.certificateNumber?.trim()) {
    parts.push(record.certificateNumber.trim());
  }
  const status = normalizeVerificationStatus(record);
  parts.push(status.charAt(0).toUpperCase() + status.slice(1));
  return parts.join(' · ');
}

const REJECTED_RESUBMIT_CLEAR_FIELDS = [
  'rejectedAt',
  'rvPaymentStatus',
  'rvPaymentId',
  'rvPaymentAmount',
  'rvPaidAt',
  'zohoInvoiceId',
  'zohoInvoiceNumber',
  'zohoInvoiceStatus',
  'zohoCustomerId',
  'zohoCustomerName',
  'zohoInvoiceTotal',
  'zohoOrganizationId',
  'zohoPushStatus',
  'zohoPushedAt',
  'zohoPushError',
  'zohoCustomerPaymentId',
  'zohoCustomerPaymentStatus',
  'zohoCustomerPaymentAmountInr',
  'zohoExpenseId',
  'zohoExpenseStatus',
  'zohoExpenseAmountInr',
  'zohoSettlementStatus',
  'zohoSettlementError',
  'zohoSettledAt',
  'zohoInvoiceReferenceNumber',
  'zohoInvoiceReferenceSynced',
  'zohoInvoiceReferenceSyncedAt',
  'zohoInvoiceReferenceSyncError',
] as const;

function stripCertificateOutcomeFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...data };
  for (const key of CERTIFICATE_OUTCOME_FIELDS) {
    delete next[key];
  }
  delete next.certificateQuality;
  delete next.certificateVoidedAt;
  delete next.certificateVoidedByUid;
  delete next.certificateVoidReason;
  delete next.resubmittedFromId;
  delete next.resubmissionRootId;
  delete next.resubmissionOrdinal;
  delete next.resubmittedByUid;
  delete next.resubmittedAt;
  delete next.id;
  return next;
}

function stripRejectedResubmitFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const next = stripCertificateOutcomeFields(data);
  for (const key of REJECTED_RESUBMIT_CLEAR_FIELDS) {
    delete next[key];
  }
  return next;
}

/** Super Admin may queue a fresh DOCA run from a permanently rejected verification. */
export function canResubmitRejectedVerification(
  record: SiteCalibration,
  group: SiteCalibration[],
  isSuperAdmin: boolean,
): boolean {
  if (!isSuperAdmin) return false;
  if (!isVerificationRejected(record)) return false;
  if (isVerificationCertificateVoided(record)) return false;
  if (record.supersededByResubmissionId?.trim()) return false;
  if (hasPendingResubmission(record.id, group)) return false;
  return true;
}

export type RejectedResubmitReusableRvPayment = {
  paymentId: string;
  amountInr: number;
  paidAt?: string;
  sourceRecordId: string;
};

/**
 * Active (non-refunded) RV wallet payment on this serial — reuse, do not debit again.
 * Refunded ledger entries are skipped so resubmit charges wallet again.
 */
export async function findSerialRvWalletPayment(
  record: SiteCalibration,
  group: SiteCalibration[],
): Promise<RejectedResubmitReusableRvPayment | null> {
  if (!isRvWalletPaymentRequired(record.verificationType ?? '')) return null;

  const candidates = [record, ...group.filter(r => r.id !== record.id)];
  for (const candidate of candidates) {
    if (candidate.verificationType !== 'RV') continue;
    if (candidate.rvPaymentStatus !== 'paid') continue;
    const paymentId = candidate.rvPaymentId?.trim();
    if (!paymentId) continue;
    const amountInr = candidate.rvPaymentAmount;
    if (amountInr == null || !(amountInr > 0)) continue;
    if (!(await isActiveRvWalletPayment(paymentId))) continue;
    return {
      paymentId,
      amountInr,
      paidAt: candidate.rvPaidAt?.trim() || undefined,
      sourceRecordId: candidate.id,
    };
  }
  return null;
}

/** True when RV and this serial has no active (non-refunded) wallet payment to carry forward. */
export async function rejectedResubmitNeedsFreshWalletCharge(
  record: SiteCalibration,
  group: SiteCalibration[],
): Promise<boolean> {
  if (!isRvWalletPaymentRequired(record.verificationType ?? '')) return false;
  return (await findSerialRvWalletPayment(record, group)) == null;
}

export type ResubmitVerificationResult = {
  newRecordId: string;
  applicationNumber: string;
};

/**
 * Marks the source as corrupted and creates a duplicate Firestore document in
 * `submitted` status for the certificate worker to process.
 */
export async function resubmitVerificationForDoca(
  firestore: Firestore,
  source: SiteCalibration,
  resubmittedByUid: string,
): Promise<ResubmitVerificationResult> {
  const now = new Date().toISOString();
  const newRef = doc(collection(firestore, 'siteCalibrations'));
  const applicationNumber = await allocateVerificationApplicationNumber(firestore);

  const rootId = source.resubmissionRootId?.trim() || source.id;
  const ordinal = (source.resubmissionOrdinal ?? 1) + 1;

  const base = stripCertificateOutcomeFields(
    source as unknown as Record<string, unknown>,
  );

  await setDoc(newRef, {
    ...base,
    status: 'submitted',
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    applicationNumber,
    resubmittedFromId: source.id,
    resubmissionRootId: rootId,
    resubmissionOrdinal: ordinal,
    resubmittedByUid,
    resubmittedAt: now,
    createdByUid: resubmittedByUid,
  });

  const certificationFailed = isCertificationFailureResubmitSource(source);
  await updateDoc(doc(firestore, 'siteCalibrations', source.id), {
    certificateQuality: certificationFailed
      ? ('certification_failed' satisfies CertificateQuality)
      : ('corrupted_qr' satisfies CertificateQuality),
    supersededByResubmissionId: newRef.id,
    updatedAt: now,
  });

  return { newRecordId: newRef.id, applicationNumber };
}

export type RejectedResubmitRvPayment = {
  paymentId: string;
  amountInr: number;
};

/**
 * Clones a rejected verification into `submitted` for the certificate worker.
 * RV reuses an existing serial wallet payment when present; only unpaid serials debit again.
 */
export async function resubmitRejectedVerification(
  firestore: Firestore,
  source: SiteCalibration,
  resubmittedByUid: string,
  options?: {
    group?: SiteCalibration[];
    /** Fresh wallet debit — only when serial has no prior paid RV payment. */
    rvPayment?: RejectedResubmitRvPayment;
  },
): Promise<ResubmitVerificationResult> {
  if (!isVerificationRejected(source)) {
    throw new Error('Only rejected verifications can use this resubmit path.');
  }
  if (source.supersededByResubmissionId?.trim()) {
    throw new Error('This rejected verification was already resubmitted.');
  }

  const group = options?.group?.length ? options.group : [source];
  const isRv = isRvWalletPaymentRequired(source.verificationType ?? '');
  const reusablePayment = isRv ? await findSerialRvWalletPayment(source, group) : null;
  const freshPayment = options?.rvPayment;

  if (isRv && !reusablePayment) {
    if (!freshPayment?.paymentId?.trim() || !(freshPayment.amountInr > 0)) {
      throw new Error('RV rejected resubmit requires a wallet payment for this serial.');
    }
  }

  const now = new Date().toISOString();
  const newRef = doc(collection(firestore, 'siteCalibrations'));
  const applicationNumber = await allocateVerificationApplicationNumber(firestore);

  const rootId = source.resubmissionRootId?.trim() || source.id;
  const ordinal = (source.resubmissionOrdinal ?? 1) + 1;

  const base = stripRejectedResubmitFields(
    source as unknown as Record<string, unknown>,
  );

  let paymentFields: Record<string, unknown>;
  if (!isRv) {
    paymentFields = { rvPaymentStatus: 'not_required' as const };
  } else if (reusablePayment) {
    paymentFields = {
      rvPaymentStatus: 'paid' as const,
      rvPaymentId: reusablePayment.paymentId,
      rvPaymentAmount: reusablePayment.amountInr,
      rvPaidAt: reusablePayment.paidAt || now,
    };
  } else if (freshPayment) {
    paymentFields = buildRvPaymentFirestorePatch(freshPayment.paymentId, freshPayment.amountInr);
  } else {
    throw new Error('RV rejected resubmit requires a wallet payment for this serial.');
  }

  await setDoc(newRef, {
    ...base,
    ...paymentFields,
    status: 'submitted',
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    applicationNumber,
    resubmittedFromId: source.id,
    resubmissionRootId: rootId,
    resubmissionOrdinal: ordinal,
    resubmittedByUid,
    resubmittedAt: now,
    createdByUid: resubmittedByUid,
    zohoPushStatus: 'skipped',
  });

  await updateDoc(doc(firestore, 'siteCalibrations', source.id), {
    supersededByResubmissionId: newRef.id,
    updatedAt: now,
  });

  return { newRecordId: newRef.id, applicationNumber };
}

/**
 * Voids every other certificate for this serial, then queues one DOCA resubmission
 * from the preferred (or latest) eligible record.
 */
export async function resubmitSerialGroupForDoca(
  firestore: Firestore,
  group: SiteCalibration[],
  resubmittedByUid: string,
  preferred?: SiteCalibration,
): Promise<ResubmitVerificationResult> {
  if (hasPendingResubmissionInGroup(group)) {
    throw new Error('A resubmission for this serial is already in progress.');
  }

  const source = pickResubmitSourceForSerialGroup(group, preferred);
  if (!source) {
    throw new Error('No eligible certificate to resubmit from.');
  }

  for (const record of group) {
    if (record.id === source.id) continue;
    if (canVoidVerificationCertificate(record)) {
      await voidVerificationCertificate(firestore, record, resubmittedByUid, 'admin');
    }
  }

  return resubmitVerificationForDoca(firestore, source, resubmittedByUid);
}
