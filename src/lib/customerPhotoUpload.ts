import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '../firebase';
import {
  deleteProductStorageFile,
  validateProductImageFile,
  type ProductFileMeta,
} from './productApprovalUpload';

function mapStorageError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: string }).code)
      : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error('Upload denied. Sign out and sign in again, then retry.');
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

async function ensureUploadAuth(): Promise<void> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to upload files.');
  await user.getIdToken(true);
}

async function uploadCustomerImage(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateProductImageFile(file);
  if (validation) throw new Error(validation);

  await ensureUploadAuth();

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

export async function uploadCustomerShopPhoto(
  customerId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  if (!customerId.trim()) throw new Error('Save the customer first to upload a photo.');
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  return uploadCustomerImage(`customers/${customerId}/shop-photo/${Date.now()}${ext}`, file, onProgress);
}

export async function uploadCustomerDeviceImage(
  customerId: string,
  deviceId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  if (!customerId.trim()) throw new Error('Save the customer first to upload device photos.');
  if (!deviceId.trim()) throw new Error('Device id is required to upload a photo.');
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  return uploadCustomerImage(
    `customers/${customerId}/devices/${deviceId}/${Date.now()}${ext}`,
    file,
    onProgress,
  );
}

/** @deprecated use uploadCustomerShopPhoto */
export const uploadCustomerPhoto = uploadCustomerShopPhoto;

export { deleteProductStorageFile as deleteCustomerStorageFile };
