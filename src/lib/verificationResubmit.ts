import { collection, doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { allocateVerificationApplicationNumber } from './verificationApplicationNumber';
import {
  canDownloadVerificationCertificate,
  isVerificationCertifiedOnDoca,
  isVerificationFullyCertified,
  isVerificationStuckAtApproved,
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

  const status = normalizeVerificationStatus(record);
  if (status !== 'certified' && status !== 'approved') return false;

  if (isVerificationStuckAtApproved(record)) return true;

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

  const stuckApproved = isVerificationStuckAtApproved(source);
  await updateDoc(doc(firestore, 'siteCalibrations', source.id), {
    certificateQuality: stuckApproved
      ? ('certification_failed' satisfies CertificateQuality)
      : ('corrupted_qr' satisfies CertificateQuality),
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
