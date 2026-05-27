import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '../firebase';
import {
  validateProductImageFile,
  type ProductFileMeta,
} from './productApprovalUpload';
import {
  VERIFICATION_IMAGE_CONFIG,
  type VerificationImageKind,
} from './verificationDeviceImages';
import {
  RV_DOCUMENT_CONFIG,
  type RvDocumentKind,
} from './verificationRvDeviceImages';

export type SiteCalibrationUploadKind = VerificationImageKind | RvDocumentKind;

function uploadConfigForKind(kind: SiteCalibrationUploadKind) {
  if (kind in VERIFICATION_IMAGE_CONFIG) {
    return VERIFICATION_IMAGE_CONFIG[kind as VerificationImageKind];
  }
  return RV_DOCUMENT_CONFIG[kind as RvDocumentKind];
}

function mapStorageError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: string }).code)
      : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error(
      'Upload denied. Deploy storage rules (firebase deploy --only storage) and sign in again, then retry.',
    );
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

async function ensureUploadAuth(): Promise<void> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to upload files.');
  await user.getIdToken(true);
}

export async function uploadSiteCalibrationDeviceImage(
  recordId: string,
  kind: SiteCalibrationUploadKind,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateProductImageFile(file);
  if (validation) throw new Error(validation);
  if (!recordId.trim()) throw new Error('Record id is required to upload verification image.');

  await ensureUploadAuth();

  const folder = uploadConfigForKind(kind).storageFolder;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const path = `siteCalibrations/${recordId}/${folder}/${Date.now()}${ext}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      snapshot => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress?.(pct);
      },
      err => reject(mapStorageError(err)),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ url, path, name: file.name, contentType: file.type });
      },
    );
  });
}

/** @deprecated Use uploadSiteCalibrationDeviceImage(recordId, 'scale', file) */
export async function uploadSiteCalibrationScaleImage(
  recordId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  return uploadSiteCalibrationDeviceImage(recordId, 'scale', file, onProgress);
}
