import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, storage } from '../firebase';

const MAX_BYTES = 15 * 1024 * 1024;

const APPROVAL_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export interface ProductFileMeta {
  url: string;
  path: string;
  name: string;
  contentType: string;
}

/** @deprecated Use ProductFileMeta */
export type ModelApprovalDocMeta = ProductFileMeta;

export function sanitizeModelIdForStorage(modelid: string): string {
  const s = modelid.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return s || 'unknown-model';
}

export function validateApprovalFile(file: File): string | null {
  if (!APPROVAL_TYPES.has(file.type)) {
    return 'Only PDF and image files (JPEG, PNG, WebP, GIF) are allowed.';
  }
  if (file.size > MAX_BYTES) {
    return 'File must be 15 MB or smaller.';
  }
  return null;
}

export function validateProductImageFile(file: File): string | null {
  if (!IMAGE_TYPES.has(file.type)) {
    return 'Only image files (JPEG, PNG, WebP, GIF) are allowed.';
  }
  if (file.size > MAX_BYTES) {
    return 'File must be 15 MB or smaller.';
  }
  return null;
}

function buildStoragePath(modelid: string, folder: string, file: File): string {
  const safeId = sanitizeModelIdForStorage(modelid);
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const stamp = Date.now();
  return `products/${safeId}/${folder}/${stamp}${ext}`;
}

function mapStorageError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: string }).code)
      : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error(
      'Upload denied. Sign in again as Super Admin. If this persists, deploy Storage rules: firebase deploy --only storage',
    );
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

async function uploadProductFile(
  modelid: string,
  file: File,
  folder: string,
  validate: (f: File) => string | null,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validate(file);
  if (validation) throw new Error(validation);

  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('You must be signed in to upload files.');
  }

  const path = buildStoragePath(modelid, folder, file);
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
        resolve({
          url,
          path,
          name: file.name,
          contentType: file.type,
        });
      },
    );
  });
}

export function uploadModelApprovalDoc(
  modelid: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  return uploadProductFile(modelid, file, 'model-approval', validateApprovalFile, onProgress);
}

export function uploadProductImage(
  modelid: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  return uploadProductFile(modelid, file, 'product-image', validateProductImageFile, onProgress);
}

export async function deleteProductStorageFile(storagePath: string): Promise<void> {
  if (!storagePath) return;
  await deleteObject(ref(storage, storagePath));
}

/** @deprecated Use deleteProductStorageFile */
export const deleteModelApprovalDoc = deleteProductStorageFile;

export function isPdfContentType(contentType?: string): boolean {
  return contentType === 'application/pdf';
}
