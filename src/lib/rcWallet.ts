import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, db } from '../firebase';
import type { RcWallet, WalletLedgerEntry, WalletTopUp, WalletTopUpStatus } from '../types';
import type { RvPaymentBreakdown } from './rvPaymentAmount';

export const RC_WALLETS_COLLECTION = 'rcWallets';
export const WALLET_TOP_UPS_COLLECTION = 'walletTopUps';
export const WALLET_LEDGER_COLLECTION = 'walletLedger';

const FUNCTIONS_REGION = 'us-central1';

let cachedSubmitTopUpUrl: string | null = null;

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

export function isWalletPaymentId(paymentId: string | undefined | null): boolean {
  return typeof paymentId === 'string' && paymentId.startsWith('wallet:');
}

async function resolveSubmitWalletTopUpUrl(): Promise<string> {
  if (cachedSubmitTopUpUrl) return cachedSubmitTopUpUrl;

  const fromEnv = import.meta.env.VITE_SUBMIT_WALLET_TOP_UP_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    cachedSubmitTopUpUrl = fromEnv.trim();
    return cachedSubmitTopUpUrl;
  }

  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('You must be signed in to submit a top-up.');
  }

  const fn = httpsCallable<Record<string, never>, { submitTopUpUrl: string }>(
    functionsClient(),
    'getWalletApiConfig',
  );
  const result = await fn({});
  const url = result.data.submitTopUpUrl?.trim();
  if (!url) {
    throw new Error('Wallet upload endpoint is not configured.');
  }

  cachedSubmitTopUpUrl = url;
  return url;
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

  const url = await resolveSubmitWalletTopUpUrl();

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

export function subscribeRcWalletBalance(
  rcId: string,
  onChange: (balance: number) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    rcWalletRef(rcId),
    snap => {
      if (!snap.exists()) {
        onChange(0);
        return;
      }
      const data = snap.data() as RcWallet;
      onChange(Number.isFinite(data.balanceInr) ? data.balanceInr : 0);
    },
    err => onError?.(err instanceof Error ? err : new Error('Failed to load wallet balance.')),
  );
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

export function subscribeWalletTopUps(
  filters: { rcId?: string; status?: WalletTopUpStatus },
  onChange: (rows: WalletTopUp[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [orderBy('submittedAt', 'desc')];
  if (filters.rcId) constraints.unshift(where('rcId', '==', filters.rcId));
  if (filters.status) constraints.unshift(where('status', '==', filters.status));

  return onSnapshot(
    query(collection(db, WALLET_TOP_UPS_COLLECTION), ...constraints),
    snap => {
      onChange(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<WalletTopUp, 'id'>) })));
    },
    err => onError?.(err instanceof Error ? err : new Error('Failed to load top-up history.')),
  );
}

export async function hasPendingWalletTopUpDuplicate(
  rcId: string,
  amountInr: number,
): Promise<boolean> {
  const pending = await fetchWalletTopUps({ rcId, status: 'pending' });
  const normalized = Math.round(amountInr * 100) / 100;
  return pending.some(item => Math.round(item.amountInr * 100) / 100 === normalized);
}

export async function fetchWalletLedger(filters: {
  rcId?: string;
  limit?: number;
}): Promise<WalletLedgerEntry[]> {
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
  if (filters.rcId) constraints.unshift(where('rcId', '==', filters.rcId));

  const snap = await getDocs(query(collection(db, WALLET_LEDGER_COLLECTION), ...constraints));
  const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<WalletLedgerEntry, 'id'>) }));
  return filters.limit ? rows.slice(0, filters.limit) : rows;
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
  reused?: boolean;
};

export async function payRvFromWallet(input: {
  rcId: string;
  amountInr: number;
  breakdown: RvPaymentBreakdown;
  idempotencyKey: string;
  recordIds?: string[];
}): Promise<PayRvFromWalletResult> {
  const fn = httpsCallable<typeof input, PayRvFromWalletResult>(
    functionsClient(),
    'payRvFromWallet',
  );
  const result = await fn(input);
  return result.data;
}

export type RefundRvWalletPaymentResult = {
  paymentId: string;
  balanceInr: number;
  refunded: boolean;
  reused?: boolean;
};

export async function refundRvWalletPayment(input: {
  paymentId: string;
  reason?: string;
}): Promise<RefundRvWalletPaymentResult> {
  const fn = httpsCallable<typeof input, RefundRvWalletPaymentResult>(
    functionsClient(),
    'refundRvWalletPayment',
  );
  const result = await fn(input);
  return result.data;
}

export async function linkWalletPaymentToRecords(input: {
  paymentId: string;
  recordIds: string[];
}): Promise<{ paymentId: string; recordIds: string[] }> {
  const fn = httpsCallable<typeof input, { paymentId: string; recordIds: string[] }>(
    functionsClient(),
    'linkWalletPaymentToRecords',
  );
  const result = await fn(input);
  return result.data;
}

export function walletTopUpStatusLabel(status: WalletTopUpStatus): string {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}

export function walletLedgerTypeLabel(type: WalletLedgerEntry['type']): string {
  if (type === 'top_up_credit') return 'Top-up credit';
  if (type === 'rv_refund') return 'RV refund';
  return 'RV payment';
}
