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
  PERFORMER_PHOTO_CONFIG,
  type PerformerPhotoKind,
} from './verificationPerformerPhotos';
import {
  RV_DOCUMENT_CONFIG,
  type RvDocumentKind,
} from './verificationRvDeviceImages';
import { prepareImageForUpload } from './prepareImageForUpload';

export type SiteCalibrationUploadKind = VerificationImageKind | RvDocumentKind | PerformerPhotoKind;

function uploadConfigForKind(kind: SiteCalibrationUploadKind) {
  if (kind in VERIFICATION_IMAGE_CONFIG) {
    return VERIFICATION_IMAGE_CONFIG[kind as VerificationImageKind];
  }
  if (kind in PERFORMER_PHOTO_CONFIG) {
    return PERFORMER_PHOTO_CONFIG[kind as PerformerPhotoKind];
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

  let uploadFile: File;
  try {
    uploadFile = await prepareImageForUpload(file);
  } catch {
    uploadFile = file;
  }
  const postCompressValidation = validateProductImageFile(uploadFile);
  if (postCompressValidation) throw new Error(postCompressValidation);

  const folder = uploadConfigForKind(kind).storageFolder;
  const ext = uploadFile.name.includes('.') ? uploadFile.name.slice(uploadFile.name.lastIndexOf('.')) : '.jpg';
  const path = `siteCalibrations/${recordId}/${folder}/${Date.now()}${ext}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, uploadFile, { contentType: uploadFile.type });

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
        resolve({ url, path, name: uploadFile.name, contentType: uploadFile.type });
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
