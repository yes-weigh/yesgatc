import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, db } from '../firebase';
import type { RcWallet, WalletTopUp, WalletTopUpStatus } from '../types';

export const RC_WALLETS_COLLECTION = 'rcWallets';
export const WALLET_TOP_UPS_COLLECTION = 'walletTopUps';

const FUNCTIONS_REGION = 'us-central1';

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

function submitWalletTopUpUrl(): string {
  const fromEnv = import.meta.env.VITE_SUBMIT_WALLET_TOP_UP_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  const projectId = app.options.projectId ?? 'yesgatc';
  return `https://us-central1-${projectId}.cloudfunctions.net/submitWalletTopUp`;
}

export async function submitWalletTopUpWithScreenshot(input: {
  amountInr: number;
  note?: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<{ topUpId: string }> {
  if (!Number.isFinite(input.amountInr) || input.amountInr <= 0) {
    throw new Error('Enter a valid payment amount.');
  }

  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to submit a top-up.');

  const token = await user.getIdToken(true);
  const formData = new FormData();
  formData.append('amountInr', String(input.amountInr));
  formData.append('note', input.note?.trim() ?? '');
  formData.append('screenshot', input.file, input.file.name);

  const url = submitWalletTopUpUrl();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body: { topUpId?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText || '{}') as { topUpId?: string; error?: string };
      } catch {
        reject(new Error('Could not submit top-up.'));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300 && body.topUpId) {
        resolve({ topUpId: body.topUpId });
        return;
      }

      reject(new Error(body.error || 'Could not submit top-up.'));
    };

    xhr.onerror = () => reject(new Error('Network error while submitting top-up.'));
    xhr.send(formData);
  });
}

export function rcWalletRef(rcId: string) {
  return doc(db, RC_WALLETS_COLLECTION, rcId);
}

export async function fetchRcWalletBalance(rcId: string): Promise<number> {
  const snap = await getDoc(rcWalletRef(rcId));
  if (!snap.exists()) return 0;
  const data = snap.data() as RcWallet;
  return Number.isFinite(data.balanceInr) ? data.balanceInr : 0;
}

export async function fetchWalletTopUps(filters: {
  rcId?: string;
  status?: WalletTopUpStatus;
  limit?: number;
}): Promise<WalletTopUp[]> {
  const constraints: QueryConstraint[] = [orderBy('submittedAt', 'desc')];
  if (filters.rcId) constraints.unshift(where('rcId', '==', filters.rcId));
  if (filters.status) constraints.unshift(where('status', '==', filters.status));

  const snap = await getDocs(query(collection(db, WALLET_TOP_UPS_COLLECTION), ...constraints));
  const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<WalletTopUp, 'id'>) }));
  return filters.limit ? rows.slice(0, filters.limit) : rows;
}

export async function createWalletTopUpRequest(input: {
  id: string;
  rcId: string;
  rcCompanyName?: string;
  amountInr: number;
  screenshot: {
    url: string;
    path: string;
    name: string;
    contentType: string;
  };
  note?: string;
  submittedByUid: string;
}): Promise<void> {
  if (!Number.isFinite(input.amountInr) || input.amountInr <= 0) {
    throw new Error('Enter a valid payment amount.');
  }

  await setDoc(doc(db, WALLET_TOP_UPS_COLLECTION, input.id), {
    rcId: input.rcId,
    rcCompanyName: input.rcCompanyName?.trim() || '',
    amountInr: Math.round(input.amountInr * 100) / 100,
    status: 'pending' as const,
    screenshotUrl: input.screenshot.url,
    screenshotPath: input.screenshot.path,
    screenshotName: input.screenshot.name,
    screenshotContentType: input.screenshot.contentType,
    note: input.note?.trim() || '',
    submittedAt: new Date().toISOString(),
    submittedByUid: input.submittedByUid,
  });
}

export type ReviewWalletTopUpResult = {
  topUpId: string;
  status: WalletTopUpStatus;
  balanceInr: number;
};

export async function reviewWalletTopUp(input: {
  topUpId: string;
  action: 'approve' | 'reject';
  rejectionReason?: string;
}): Promise<ReviewWalletTopUpResult> {
  const fn = httpsCallable<typeof input, ReviewWalletTopUpResult>(
    functionsClient(),
    'reviewWalletTopUp',
  );
  const result = await fn(input);
  return result.data;
}

export type PayRvFromWalletResult = {
  paymentId: string;
  amountInr: number;
  balanceInr: number;
};

export async function payRvFromWallet(input: {
  rcId: string;
  amountInr: number;
  recordIds?: string[];
}): Promise<PayRvFromWalletResult> {
  const fn = httpsCallable<typeof input, PayRvFromWalletResult>(
    functionsClient(),
    'payRvFromWallet',
  );
  const result = await fn(input);
  return result.data;
}

export function walletTopUpStatusLabel(status: WalletTopUpStatus): string {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}
