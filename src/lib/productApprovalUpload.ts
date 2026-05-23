import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, storage } from '../firebase';

const MAX_BYTES = 15 * 1024 * 1024;

const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export interface ModelApprovalDocMeta {
  url: string;
  path: string;
  name: string;
  contentType: string;
}

export function sanitizeModelIdForStorage(modelid: string): string {
  const s = modelid.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return s || 'unknown-model';
}

export function validateApprovalFile(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return 'Only PDF and image files (JPEG, PNG, WebP, GIF) are allowed.';
  }
  if (file.size > MAX_BYTES) {
    return 'File must be 15 MB or smaller.';
  }
  return null;
}

export function buildApprovalStoragePath(modelid: string, file: File): string {
  const safeId = sanitizeModelIdForStorage(modelid);
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const stamp = Date.now();
  return `products/${safeId}/model-approval/${stamp}${ext}`;
}

function mapStorageError(err: unknown): Error {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: string }).code)
    : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error(
      'Upload denied. Sign in again as Super Admin. If this persists, deploy Storage rules: firebase deploy --only storage',
    );
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

export async function uploadModelApprovalDoc(
  modelid: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ModelApprovalDocMeta> {
  const validation = validateApprovalFile(file);
  if (validation) throw new Error(validation);

  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('You must be signed in to upload documents.');
  }

  const path = buildApprovalStoragePath(modelid, file);
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

export async function deleteModelApprovalDoc(storagePath: string): Promise<void> {
  if (!storagePath) return;
  await deleteObject(ref(storage, storagePath));
}

export function isPdfContentType(contentType?: string): boolean {
  return contentType === 'application/pdf';
}
