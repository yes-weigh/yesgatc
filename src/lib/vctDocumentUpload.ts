import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, storage } from '../firebase';
import {
  deleteProductStorageFile,
  validateApprovalFile,
  type ProductFileMeta,
} from './productApprovalUpload';

export type VctDocKind = 'aadhar' | 'biodata' | 'education-cert' | 'pcc';

const FOLDER_BY_KIND: Record<VctDocKind, string> = {
  aadhar: 'aadhar',
  biodata: 'biodata',
  'education-cert': 'education-cert',
  pcc: 'pcc',
};

function mapStorageError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: string }).code)
      : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error(
      'Upload denied. Sign out and sign in again, then retry.',
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

export async function uploadVctDocument(
  vctUid: string,
  kind: VctDocKind,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateApprovalFile(file);
  if (validation) throw new Error(validation);
  if (!vctUid.trim()) throw new Error('Save the technician profile first to upload documents.');

  await ensureUploadAuth();

  const folder = FOLDER_BY_KIND[kind];
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const path = `users/${vctUid}/${folder}/${Date.now()}${ext}`;
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

export { deleteProductStorageFile as deleteVctStorageFile };
