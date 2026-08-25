import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import { isEmaapCertificatePdfUrl } from './certificateVerifyUrl';
import { parseCertificateSequenceNumber } from './certificateSequence';
import { isVerificationCertificateVoided } from './verificationCertificateVoid';
import { getVerificationDisplayStatus } from './verificationRequest';
import { resolveCertificatePreviewUrl } from './verificationCertifiedActions';
import type { SiteCalibration } from '../types';

/** Certificates at or below this sequence are treated as already signed. */
export const LEGACY_SIGNED_CERTIFICATE_SEQUENCE_MAX = 2304;

const MAX_BYTES = 20 * 1024 * 1024;

export type CertificateSignStatus = 'signed' | 'not_signed' | 'voided';

export function certificateRequiresSignedUpload(record: SiteCalibration): boolean {
  if (isVerificationCertificateVoided(record)) return false;
  if (record.signedCertificatePdfUrl?.trim()) return false;
  const sequence = parseCertificateSequenceNumber(record.certificateNumber);
  if (sequence == null) return true;
  return sequence > LEGACY_SIGNED_CERTIFICATE_SEQUENCE_MAX;
}

export function certificateSignStatus(record: SiteCalibration): CertificateSignStatus {
  if (isVerificationCertificateVoided(record)) return 'voided';
  if (record.signedCertificatePdfUrl?.trim()) return 'signed';
  const sequence = parseCertificateSequenceNumber(record.certificateNumber);
  if (sequence != null && sequence <= LEGACY_SIGNED_CERTIFICATE_SEQUENCE_MAX) return 'signed';
  return 'not_signed';
}

export function hasSignedCertificatePdf(record: SiteCalibration): boolean {
  return Boolean(record.signedCertificatePdfUrl?.trim() || record.signedCertificatePdfPath?.trim());
}

export function hasEmaapSignedPdfUpload(record: SiteCalibration): boolean {
  return Boolean(record.emaapSignedPdfUploadedAt?.trim());
}

export type SignedCertificateAvailability = 'available' | 'missing' | 'legacy' | 'voided';

/** Issued certs only. Whether the DSC-signed PDF file exists in Firebase. */
export function signedCertificateAvailability(
  record: SiteCalibration,
): SignedCertificateAvailability | null {
  if (!record.certificateNumber?.trim()) return null;
  if (isVerificationCertificateVoided(record)) return 'voided';
  if (hasSignedCertificatePdf(record)) return 'available';
  const sequence = parseCertificateSequenceNumber(record.certificateNumber);
  if (sequence != null && sequence <= LEGACY_SIGNED_CERTIFICATE_SEQUENCE_MAX) return 'legacy';
  return 'missing';
}

export function signedCertificateAvailabilityLabel(
  availability: SignedCertificateAvailability,
  onEmaap = false,
): string {
  if (availability === 'available') return onEmaap ? 'Signed PDF · eMAAP' : 'Signed PDF';
  if (availability === 'missing') return 'No signed PDF';
  if (availability === 'legacy') return 'Pre-2304';
  return 'Voided';
}

export type VerificationSignedPdfFilter = 'all' | 'signed' | 'not_signed';

export function matchesSignedPdfFilter(
  record: SiteCalibration,
  filter: VerificationSignedPdfFilter,
): boolean {
  if (filter === 'all') return true;
  const availability = signedCertificateAvailability(record);
  if (filter === 'signed') return availability === 'available';
  return availability === 'missing';
}

export function tallySignedPdfFilters(records: SiteCalibration[]): {
  signed: number;
  notSigned: number;
} {
  let signed = 0;
  let notSigned = 0;
  for (const record of records) {
    const availability = signedCertificateAvailability(record);
    if (availability === 'available') signed += 1;
    else if (availability === 'missing') notSigned += 1;
  }
  return { signed, notSigned };
}

export type RcSignedPipelineCounts = {
  live: number;
  needSign: number;
  signed: number;
  emaapUploaded: number;
};

export const EMPTY_RC_SIGNED_PIPELINE_COUNTS: RcSignedPipelineCounts = {
  live: 0,
  needSign: 0,
  signed: 0,
  emaapUploaded: 0,
};

export function isSignedPipelineLiveRecord(record: SiteCalibration): boolean {
  if (isVerificationCertificateVoided(record)) return false;
  if (record.supersededByResubmissionId?.trim()) return false;
  if (getVerificationDisplayStatus(record) !== 'certified') return false;
  const sequence = parseCertificateSequenceNumber(record.certificateNumber);
  return sequence != null && sequence > LEGACY_SIGNED_CERTIFICATE_SEQUENCE_MAX;
}

export function signedPipelineCountsByRcId(
  records: SiteCalibration[],
  rcIds: string[] = [],
): Map<string, RcSignedPipelineCounts> {
  const counts = new Map<string, RcSignedPipelineCounts>();
  for (const id of rcIds) {
    if (id) counts.set(id, { ...EMPTY_RC_SIGNED_PIPELINE_COUNTS });
  }
  for (const record of records) {
    if (!isSignedPipelineLiveRecord(record)) continue;
    const id = record.rcId?.trim();
    if (!id) continue;
    const row = counts.get(id) ?? { ...EMPTY_RC_SIGNED_PIPELINE_COUNTS };
    row.live += 1;
    if (hasSignedCertificatePdf(record)) {
      row.signed += 1;
      if (hasEmaapSignedPdfUpload(record)) row.emaapUploaded += 1;
    } else {
      row.needSign += 1;
    }
    counts.set(id, row);
  }
  return counts;
}

export function resolveUnsignedCertificatePdfUrl(record: SiteCalibration): string | null {
  const stored = record.certificatePdfUrl?.trim();
  if (stored) return stored;
  const emaap = record.emaapCertificatePdfUrl?.trim();
  if (emaap && isEmaapCertificatePdfUrl(emaap)) return emaap;
  return resolveCertificatePreviewUrl(record);
}

export function resolveUnsignedCertificatePdfStoragePath(record: SiteCalibration): string | null {
  return record.certificatePdfPath?.trim() || null;
}

export function resolveSignedCertificatePdfOnlyUrl(record: SiteCalibration): string | null {
  return record.signedCertificatePdfUrl?.trim() || null;
}

export function resolveSignedCertificatePdfOnlyPath(record: SiteCalibration): string | null {
  return record.signedCertificatePdfPath?.trim() || null;
}

export function markCertificatePdfDownloaded(recordId: string): void {
  try {
    localStorage.setItem(`yesgatc.certPdfDownloaded.${recordId}`, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

export function certificatePdfDownloadedAt(recordId: string): string | null {
  try {
    return localStorage.getItem(`yesgatc.certPdfDownloaded.${recordId}`);
  } catch {
    return null;
  }
}

export function resolveCertificateDownloadUrl(record: SiteCalibration): string | null {
  return record.signedCertificatePdfUrl?.trim() || resolveCertificatePreviewUrl(record);
}

/** Direct PDF file for in-app view / native share (Epson, WhatsApp). */
export function resolveCertificatePdfFileUrl(record: SiteCalibration): string | null {
  const signed = record.signedCertificatePdfUrl?.trim();
  if (signed) return signed;
  const emaap = record.emaapCertificatePdfUrl?.trim();
  if (emaap && isEmaapCertificatePdfUrl(emaap)) return emaap;
  const stored = record.certificatePdfUrl?.trim();
  if (stored) return stored;
  return null;
}

export function resolveCertificatePdfStoragePath(record: SiteCalibration): string | null {
  return record.signedCertificatePdfPath?.trim() || record.certificatePdfPath?.trim() || null;
}

export function validateSignedCertificatePdf(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Only PDF files are allowed.';
  if (file.size > MAX_BYTES) return 'PDF must be 20 MB or smaller.';
  return null;
}

function mapStorageError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: string }).code)
      : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error('Upload denied. Sign in as RC Admin and retry.');
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

export async function uploadSignedCertificatePdf(
  recordId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Pick<
  SiteCalibration,
  | 'signedCertificatePdfUrl'
  | 'signedCertificatePdfPath'
  | 'signedCertificatePdfName'
  | 'signedCertificatePdfContentType'
  | 'signedCertificateUploadedAt'
  | 'signedCertificateUploadedByUid'
>> {
  const validation = validateSignedCertificatePdf(file);
  if (validation) throw new Error(validation);

  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to upload files.');

  const ext = file.name.toLowerCase().endsWith('.pdf') ? '.pdf' : '';
  const path = `siteCalibrations/${recordId}/signed-certificate/${Date.now()}${ext}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, { contentType: 'application/pdf' });

  const url = await new Promise<string>((resolve, reject) => {
    task.on(
      'state_changed',
      snapshot => {
        onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
      },
      err => reject(mapStorageError(err)),
      async () => resolve(await getDownloadURL(task.snapshot.ref)),
    );
  });

  const uploadedAt = new Date().toISOString();
  const patch = {
    signedCertificatePdfUrl: url,
    signedCertificatePdfPath: path,
    signedCertificatePdfName: file.name.trim() || 'signed-certificate.pdf',
    signedCertificatePdfContentType: 'application/pdf',
    signedCertificateUploadedAt: uploadedAt,
    signedCertificateUploadedByUid: user.uid,
    updatedAt: uploadedAt,
  };

  await updateDoc(doc(db, 'siteCalibrations', recordId), patch);
  return patch;
}
