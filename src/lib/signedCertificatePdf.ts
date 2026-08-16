import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import { parseCertificateSequenceNumber } from './certificateSequence';
import { isVerificationCertificateVoided } from './verificationCertificateVoid';
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

export function resolveCertificateDownloadUrl(record: SiteCalibration): string | null {
  return record.signedCertificatePdfUrl?.trim() || resolveCertificatePreviewUrl(record);
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
