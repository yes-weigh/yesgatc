import { collection, doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { allocateVerificationApplicationNumber } from './verificationApplicationNumber';
import {
  canDownloadVerificationCertificate,
  isVerificationCertifiedOnDoca,
  isVerificationFullyCertified,
  normalizeVerificationStatus,
} from './verificationRequest';
import type { SiteCalibration } from '../types';

/** Original record marked when Super Admin queues a DOCA resubmission. */
export type CertificateQuality = 'corrupted_qr';

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

/** Super Admin may queue a fresh DOCA run from a completed verification. */
export function canResubmitVerification(
  record: SiteCalibration,
  group: SiteCalibration[],
): boolean {
  if (record.supersededByResubmissionId?.trim()) return false;
  if (hasPendingResubmission(record.id, group)) return false;

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

  if (group.length > 1 && !isCorruptedCertificateRecord(record)) {
    const status = normalizeVerificationStatus(record);
    if (status === 'certified' || canDownloadVerificationCertificate(record)) {
      return 'Correct certificate';
    }
  }

  return 'Verification';
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

  await updateDoc(doc(firestore, 'siteCalibrations', source.id), {
    certificateQuality: 'corrupted_qr' satisfies CertificateQuality,
    supersededByResubmissionId: newRef.id,
    updatedAt: now,
  });

  return { newRecordId: newRef.id, applicationNumber };
}
