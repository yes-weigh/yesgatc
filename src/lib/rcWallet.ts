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
const DEFAULT_SUBMIT_WALLET_TOP_UP_URL =
  'https://us-central1-yesgatc.cloudfunctions.net/submitWalletTopUp';
const WALLET_SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024;
const WALLET_SCREENSHOT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

let cachedSubmitTopUpUrl: string | null = null;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read screenshot.'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load screenshot.'));
    image.src = dataUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not compress screenshot.'))),
      'image/jpeg',
      quality,
    );
  });
}

async function prepareWalletScreenshotPayload(file: File): Promise<{
  screenshotBase64: string;
  screenshotContentType: string;
  screenshotName: string;
}> {
  if (!WALLET_SCREENSHOT_TYPES.has(file.type)) {
    throw new Error('Screenshot must be JPEG, PNG, or WebP.');
  }

  if (file.size <= WALLET_SCREENSHOT_MAX_BYTES) {
    const dataUrl = await readFileAsDataUrl(file);
    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) throw new Error('Could not read screenshot.');
    return {
      screenshotBase64: base64,
      screenshotContentType: file.type,
      screenshotName: file.name,
    };
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(dataUrl);
  const maxEdge = 2200;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare screenshot.');
  ctx.drawImage(image, 0, 0, width, height);

  for (let quality = 0.88; quality >= 0.45; quality -= 0.08) {
    const blob = await canvasToJpegBlob(canvas, quality);
    if (blob.size <= WALLET_SCREENSHOT_MAX_BYTES) {
      const compressedDataUrl = await readFileAsDataUrl(
        new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }),
      );
      const base64 = compressedDataUrl.split(',')[1] || '';
      if (!base64) throw new Error('Could not compress screenshot.');
      return {
        screenshotBase64: base64,
        screenshotContentType: 'image/jpeg',
        screenshotName: file.name.replace(/\.\w+$/, '.jpg'),
      };
    }
  }

  throw new Error('Screenshot is too large. Use a smaller image.');
}

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

  try {
    const fn = httpsCallable<Record<string, never>, { submitTopUpUrl: string }>(
      functionsClient(),
      'getWalletApiConfig',
    );
    const result = await fn({});
    const url = result.data.submitTopUpUrl?.trim();
    if (url) {
      cachedSubmitTopUpUrl = url;
      return url;
    }
  } catch {
    // Fall back to the deployed HTTP endpoint if the config callable is unavailable.
  }

  cachedSubmitTopUpUrl = DEFAULT_SUBMIT_WALLET_TOP_UP_URL;
  return cachedSubmitTopUpUrl;
}

async function submitWalletTopUpViaCallable(input: {
  amountInr: number;
  note?: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<{ topUpId: string }> {
  input.onProgress?.(15);
  const screenshot = await prepareWalletScreenshotPayload(input.file);
  input.onProgress?.(55);

  const fn = httpsCallable<
    {
      amountInr: number;
      note?: string;
      screenshotBase64: string;
      screenshotContentType: string;
      screenshotName: string;
    },
    { topUpId: string }
  >(functionsClient(), 'submitWalletTopUpCallable');

  input.onProgress?.(75);
  const result = await fn({
    amountInr: input.amountInr,
    note: input.note?.trim() ?? '',
    ...screenshot,
  });
  input.onProgress?.(100);

  if (!result.data.topUpId) {
    throw new Error('Could not submit top-up.');
  }
  return { topUpId: result.data.topUpId };
}

async function submitWalletTopUpViaHttp(input: {
  amountInr: number;
  note?: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<{ topUpId: string }> {
  const token = await auth.currentUser!.getIdToken(true);
  const formData = new FormData();
  formData.append('amountInr', String(input.amountInr));
  formData.append('note', input.note?.trim() ?? '');
  formData.append('screenshot', input.file, input.file.name);

  const url = await resolveSubmitWalletTopUpUrl();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timeoutMs = 120_000;

    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = timeoutMs;

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
    xhr.ontimeout = () =>
      reject(new Error('Top-up submit timed out. Check your connection and try again.'));
    xhr.send(formData);
  });
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
  if (!auth.currentUser) throw new Error('You must be signed in to submit a top-up.');

  input.onProgress?.(5);

  try {
    return await submitWalletTopUpViaCallable(input);
  } catch (callableErr: unknown) {
    const callableCode =
      typeof callableErr === 'object'
      && callableErr
      && 'code' in callableErr
      && typeof callableErr.code === 'string'
        ? callableErr.code
        : '';
    const isUserFacingCallableError =
      callableCode === 'functions/already-exists'
      || callableCode === 'functions/invalid-argument'
      || callableCode === 'functions/permission-denied'
      || callableCode === 'functions/unauthenticated';

    if (isUserFacingCallableError) {
      throw callableErr instanceof Error ? callableErr : new Error('Could not submit top-up.');
    }

    try {
      return await submitWalletTopUpViaHttp(input);
    } catch (httpErr: unknown) {
      if (httpErr instanceof Error && httpErr.message) throw httpErr;
      if (callableErr instanceof Error && callableErr.message) throw callableErr;
      throw new Error('Could not submit top-up.');
    }
  }
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

export function subscribeWalletLedger(
  filters: { rcId?: string; limit?: number },
  onChange: (rows: WalletLedgerEntry[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')];
  if (filters.rcId) constraints.unshift(where('rcId', '==', filters.rcId));

  return onSnapshot(
    query(collection(db, WALLET_LEDGER_COLLECTION), ...constraints),
    snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<WalletLedgerEntry, 'id'>) }));
      onChange(filters.limit ? rows.slice(0, filters.limit) : rows);
    },
    err => onError?.(err instanceof Error ? err : new Error('Failed to load wallet transactions.')),
  );
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

export async function deleteWalletTopUp(topUpId: string): Promise<{
  topUpId: string;
  rcId: string;
  balanceInr: number;
  deleted: boolean;
}> {
  const fn = httpsCallable<{ topUpId: string }, {
    topUpId: string;
    rcId: string;
    balanceInr: number;
    deleted: boolean;
  }>(functionsClient(), 'deleteWalletTopUp');
  const result = await fn({ topUpId });
  return result.data;
}

export async function deleteWalletLedgerEntry(ledgerId: string): Promise<{
  ledgerId: string;
  rcId: string;
  balanceInr: number;
  deleted: boolean;
}> {
  const fn = httpsCallable<{ ledgerId: string }, {
    ledgerId: string;
    rcId: string;
    balanceInr: number;
    deleted: boolean;
  }>(functionsClient(), 'deleteWalletLedgerEntry');
  const result = await fn({ ledgerId });
  return result.data;
}

export async function resetRcWallet(rcId: string): Promise<{
  rcId: string;
  balanceInr: number;
  deletedTopUps: number;
  deletedLedgerEntries: number;
  reset: boolean;
}> {
  const fn = httpsCallable<{ rcId: string }, {
    rcId: string;
    balanceInr: number;
    deletedTopUps: number;
    deletedLedgerEntries: number;
    reset: boolean;
  }>(functionsClient(), 'resetRcWallet');
  const result = await fn({ rcId });
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
