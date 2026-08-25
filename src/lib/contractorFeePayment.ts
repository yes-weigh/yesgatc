import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import { prepareImageForUpload } from './prepareImageForUpload';
import { validateProductImageFile, type ProductFileMeta } from './productApprovalUpload';

export const CONTRACTOR_FEE_PAYMENTS_COLLECTION = 'contractorFeePayments';

export type ContractorFeePayment = {
  id: string;
  rcId: string;
  dateKey: string;
  amountInr: number;
  qty: number;
  status: 'paid';
  proofUrl: string;
  proofPath: string;
  proofName: string;
  proofContentType: string;
  paidAt: string;
  paidByUid: string;
  createdAt: string;
  updatedAt: string;
};

export function contractorFeePaymentId(rcId: string, dateKey: string): string {
  return `${rcId}_${dateKey}`;
}

export function contractorFeeProofUploaded(
  payment: Pick<ContractorFeePayment, 'proofUrl' | 'proofPath'> | null | undefined,
): boolean {
  return Boolean(payment?.proofUrl?.trim() || payment?.proofPath?.trim());
}

export type ContractorFeeDayCharge = {
  dateKey: string;
  amountInr: number;
};

/**
 * Unpaid contractor + handling rolls to the next date.
 * Screenshot on a date clears the running due from that date forward.
 */
export function carryForwardContractorFeeDues(
  days: ContractorFeeDayCharge[],
  payments: {
    get: (
      dateKey: string,
    ) => Pick<ContractorFeePayment, 'proofUrl' | 'proofPath'> | null | undefined;
  },
): Map<string, number> {
  const dues = new Map<string, number>();
  let running = 0;
  for (const day of [...days].sort((a, b) => a.dateKey.localeCompare(b.dateKey))) {
    running += day.amountInr;
    if (contractorFeeProofUploaded(payments.get(day.dateKey))) {
      dues.set(day.dateKey, 0);
      running = 0;
      continue;
    }
    dues.set(day.dateKey, running);
  }
  return dues;
}

function mapStorageError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: string }).code)
      : '';
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return new Error('Upload denied. Sign in again, then retry.');
  }
  return err instanceof Error ? err : new Error('Upload failed');
}

async function ensureUploadAuth(): Promise<void> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to upload files.');
  await user.getIdToken(true);
}

export async function uploadContractorFeeProof(
  rcId: string,
  dateKey: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProductFileMeta> {
  const validation = validateProductImageFile(file);
  if (validation) throw new Error(validation);
  if (!rcId.trim() || !dateKey.trim()) throw new Error('Payment id is required.');

  await ensureUploadAuth();

  let uploadFile: File;
  try {
    uploadFile = await prepareImageForUpload(file);
  } catch {
    uploadFile = file;
  }
  const postCompressValidation = validateProductImageFile(uploadFile);
  if (postCompressValidation) throw new Error(postCompressValidation);

  const ext = uploadFile.name.includes('.')
    ? uploadFile.name.slice(uploadFile.name.lastIndexOf('.'))
    : '.jpg';
  const path = `users/${rcId}/contractor-fee-proof/${dateKey}-${Date.now()}${ext}`;
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

export async function markContractorFeePaid(input: {
  rcId: string;
  dateKey: string;
  amountInr: number;
  qty: number;
  proof: ProductFileMeta;
  existing?: ContractorFeePayment | null;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in.');
  const now = new Date().toISOString();
  const payload: Omit<ContractorFeePayment, 'id'> = {
    rcId: input.rcId,
    dateKey: input.dateKey,
    amountInr: input.amountInr,
    qty: input.qty,
    status: 'paid',
    proofUrl: input.proof.url,
    proofPath: input.proof.path,
    proofName: input.proof.name,
    proofContentType: input.proof.contentType,
    paidAt: input.existing?.paidAt || now,
    paidByUid: user.uid,
    createdAt: input.existing?.createdAt || now,
    updatedAt: now,
  };
  await setDoc(
    doc(db, 'users', input.rcId, CONTRACTOR_FEE_PAYMENTS_COLLECTION, input.dateKey),
    payload,
    { merge: true },
  );
}

export function subscribeContractorFeePayments(
  rcId: string,
  onChange: (byDate: Map<string, ContractorFeePayment>) => void,
): () => void {
  const q = collection(db, 'users', rcId, CONTRACTOR_FEE_PAYMENTS_COLLECTION);
  return onSnapshot(q, snap => {
    const byDate = new Map<string, ContractorFeePayment>();
    snap.docs.forEach(d => {
      const row = { id: d.id, ...(d.data() as Omit<ContractorFeePayment, 'id'>) };
      if (row.dateKey) byDate.set(row.dateKey, row);
    });
    onChange(byDate);
  });
}
