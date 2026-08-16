import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import { deleteProductStorageFile } from './productApprovalUpload';

export const MANUAL_PDFS_COLLECTION = 'manualPdfs';

const MAX_BYTES = 20 * 1024 * 1024;

export type ManualPdfDoc = {
  id: string;
  name: string;
  url: string;
  path: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
};

export function formatManualPdfSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateManualPdfFile(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Only PDF files are allowed.';
  if (file.size > MAX_BYTES) return 'PDF must be 20 MB or smaller.';
  return null;
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return trimmed || 'manual.pdf';
}

function mapStorageError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: string }).code)
      : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error(
      'Upload denied. Sign in as Super Admin, then deploy Storage rules if this persists.',
    );
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

export function parseManualPdfDoc(id: string, data: Record<string, unknown>): ManualPdfDoc | null {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const url = typeof data.url === 'string' ? data.url.trim() : '';
  const path = typeof data.path === 'string' ? data.path.trim() : '';
  if (!name || !url) return null;
  return {
    id,
    name,
    url,
    path,
    contentType: typeof data.contentType === 'string' ? data.contentType : 'application/pdf',
    size: typeof data.size === 'number' && Number.isFinite(data.size) ? data.size : 0,
    uploadedAt: typeof data.uploadedAt === 'string' ? data.uploadedAt : '',
    uploadedBy: typeof data.uploadedBy === 'string' ? data.uploadedBy : '',
  };
}

export function subscribeManualPdfs(
  onData: (docs: ManualPdfDoc[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, MANUAL_PDFS_COLLECTION),
    snap => {
      const rows = snap.docs
        .flatMap(item => {
          const parsed = parseManualPdfDoc(item.id, item.data() as Record<string, unknown>);
          return parsed ? [parsed] : [];
        })
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || a.name.localeCompare(b.name));
      onData(rows);
    },
    err => onError?.(err instanceof Error ? err : new Error('Could not load manuals.')),
  );
}

export async function uploadManualPdf(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ManualPdfDoc> {
  const validation = validateManualPdfFile(file);
  if (validation) throw new Error(validation);

  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to upload files.');

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${MANUAL_PDFS_COLLECTION}/${id}/${sanitizeFileName(file.name)}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, { contentType: 'application/pdf' });

  const url = await new Promise<string>((resolve, reject) => {
    task.on(
      'state_changed',
      snapshot => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress?.(pct);
      },
      err => reject(mapStorageError(err)),
      async () => {
        resolve(await getDownloadURL(task.snapshot.ref));
      },
    );
  });

  const record: Omit<ManualPdfDoc, 'id'> = {
    name: file.name.trim() || 'manual.pdf',
    url,
    path,
    contentType: 'application/pdf',
    size: file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: user.uid,
  };

  await setDoc(doc(db, MANUAL_PDFS_COLLECTION, id), record);
  return { id, ...record };
}

export async function deleteManualPdf(record: ManualPdfDoc): Promise<void> {
  if (record.path) {
    try {
      await deleteProductStorageFile(record.path);
    } catch {
      // Drop Firestore row even if storage object is already gone.
    }
  }
  await deleteDoc(doc(db, MANUAL_PDFS_COLLECTION, record.id));
}
