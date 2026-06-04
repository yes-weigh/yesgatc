import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import {
  canDownloadVerificationCertificate,
  isVerificationCertifiedOnDoca,
  normalizeVerificationStatus,
} from './verificationRequest';
import type { SiteCalibration } from '../types';

export type CertificateVoidReason = 'admin' | 'resubmit_superseded';

export function isVerificationCertificateVoided(record: SiteCalibration): boolean {
  return Boolean(record.certificateVoidedAt?.trim());
}

export function canVoidVerificationCertificate(record: SiteCalibration): boolean {
  if (isVerificationCertificateVoided(record)) return false;

  const status = normalizeVerificationStatus(record);
  if (status !== 'certified' && status !== 'approved') return false;

  return (
    isVerificationCertifiedOnDoca(record) ||
    canDownloadVerificationCertificate(record) ||
    Boolean(record.certificateNumber?.trim())
  );
}

/** When a resubmission is certified, void its source if the worker has not already. */
export async function syncVoidSupersededResubmitSources(
  firestore: Firestore,
  records: SiteCalibration[],
  voidedByUid: string,
): Promise<void> {
  const byId = new Map(records.map(r => [r.id, r]));

  for (const child of records) {
    const sourceId = child.resubmittedFromId?.trim();
    if (!sourceId) continue;

    const source = byId.get(sourceId);
    if (!source || isVerificationCertificateVoided(source)) continue;

    const childDone =
      isVerificationCertifiedOnDoca(child) || canDownloadVerificationCertificate(child);
    if (!childDone) continue;

    await voidVerificationCertificate(firestore, source, voidedByUid, 'resubmit_superseded');
  }
}

export async function voidVerificationCertificate(
  firestore: Firestore,
  record: SiteCalibration,
  voidedByUid: string,
  reason: CertificateVoidReason = 'admin',
): Promise<void> {
  if (isVerificationCertificateVoided(record)) return;

  if (reason === 'admin' && !canVoidVerificationCertificate(record)) {
    throw new Error('This verification cannot be marked as void.');
  }

  if (reason === 'resubmit_superseded' && !record.certificateNumber?.trim()) {
    return;
  }

  const now = new Date().toISOString();
  await updateDoc(doc(firestore, 'siteCalibrations', record.id), {
    certificateVoidedAt: now,
    certificateVoidedByUid: voidedByUid,
    certificateVoidReason: reason,
    updatedAt: now,
  });
}
