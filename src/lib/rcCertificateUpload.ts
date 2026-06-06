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
      'Upload denied. Sign out and sign in again as Super Admin, then retry.',
    );
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

async function ensureUploadAuth(): Promise<void> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to upload files.');
  }
  await user.getIdToken(true);
}

export async function uploadRcStandardWeightsCert(
  rcUid: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateApprovalFile(file);
  if (validation) throw new Error(validation);
  if (!rcUid.trim()) throw new Error('Save the regional center first to upload the certificate.');

  await ensureUploadAuth();

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

const MAX_SEAL_BYTES = 15 * 1024 * 1024;

export function validateRcSealFile(file: File): string | null {
  if (file.type !== 'image/png') {
    return 'Seal must be a PNG file with transparent background.';
  }
  if (file.size > MAX_SEAL_BYTES) {
    return 'Seal file must be 15 MB or smaller.';
  }
  return null;
}

export async function uploadRcPanCard(
  rcUid: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateApprovalFile(file);
  if (validation) throw new Error(validation);
  if (!rcUid.trim()) throw new Error('Save the regional center first to upload the PAN card image.');

  await ensureUploadAuth();

  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const path = `users/${rcUid}/pan-card/${Date.now()}${ext}`;
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

export async function uploadRcSeal(
  rcUid: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateRcSealFile(file);
  if (validation) throw new Error(validation);
  if (!rcUid.trim()) throw new Error('Save the regional center first to upload the seal.');

  await ensureUploadAuth();

  const path = `users/${rcUid}/seal/${Date.now()}.png`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, { contentType: 'image/png' });

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
        resolve({ url, path, name: file.name, contentType: 'image/png' });
      },
    );
  });
}
