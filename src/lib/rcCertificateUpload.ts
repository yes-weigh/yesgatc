import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '../firebase';
import {
  deleteProductStorageFile,
  validateApprovalFile,
  type ProductFileMeta,
} from './productApprovalUpload';

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

export async function uploadRcStandardWeightsCert(
  rcUid: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateApprovalFile(file);
  if (validation) throw new Error(validation);
  if (!rcUid.trim()) throw new Error('Save the regional center first to upload the certificate.');

  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('You must be signed in to upload files.');
  }

  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const path = `users/${rcUid}/standard-weights-cert/${Date.now()}${ext}`;
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

export { deleteProductStorageFile as deleteRcStorageFile };
