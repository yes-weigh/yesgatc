import type { Product } from '../types';
import { resolveStorageFileUrl } from './storageImageUrl';

const DB_NAME = 'yesgatc-product-images';
const DB_VERSION = 1;
const STORE = 'blobs';

type CacheRecord = {
  key: string;
  blob: Blob;
  updatedAt: number;
  sourceUrl: string;
};

const memoryUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function productImageKey(url?: string | null, path?: string | null): string | null {
  const storagePath = path?.trim() || '';
  if (storagePath) return `path:${storagePath}`;
  const direct = url?.trim() || '';
  if (direct) return `url:${direct}`;
  return null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

async function idbGet(key: string): Promise<CacheRecord | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CacheRecord | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
    });
  } catch {
    return null;
  }
}

async function idbPut(record: CacheRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
    });
  } catch {
    // Ignore cache write failures — network URL still works.
  }
}

function rememberBlobUrl(key: string, blob: Blob): string {
  const existing = memoryUrls.get(key);
  if (existing) URL.revokeObjectURL(existing);
  const blobUrl = URL.createObjectURL(blob);
  memoryUrls.set(key, blobUrl);
  return blobUrl;
}

async function fetchAndStore(key: string, sourceUrl: string): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || !blob.type.startsWith('image/')) return null;
    await idbPut({ key, blob, updatedAt: Date.now(), sourceUrl });
    return rememberBlobUrl(key, blob);
  } catch {
    return null;
  }
}

/** Local blob URL if already cached on device; otherwise null. */
export async function getCachedProductImageUrl(
  url?: string | null,
  path?: string | null,
): Promise<string | null> {
  const key = productImageKey(url, path);
  if (!key) return null;
  const mem = memoryUrls.get(key);
  if (mem) return mem;
  const cached = await idbGet(key);
  if (!cached?.blob) return null;
  return rememberBlobUrl(key, cached.blob);
}

/**
 * Resolve product image for display: device cache first, then network.
 * Successful network loads are stored in IndexedDB for next open.
 */
export async function resolveProductImageSrc(
  url?: string | null,
  path?: string | null,
): Promise<string | null> {
  const key = productImageKey(url, path);
  if (!key) return null;

  const cached = await getCachedProductImageUrl(url, path);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const remote = await resolveStorageFileUrl(url, path);
    if (!remote) return null;
    const stored = await fetchAndStore(key, remote);
    return stored || remote;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}

/** Warm device cache for catalogue thumbs (idle / background). */
export function prefetchProductImages(products: Product[]): void {
  if (typeof window === 'undefined' || products.length === 0) return;

  const run = () => {
    void (async () => {
      for (const product of products) {
        if (!product.productImageUrl && !product.productImagePath) continue;
        const key = productImageKey(product.productImageUrl, product.productImagePath);
        if (!key) continue;
        if (memoryUrls.has(key)) continue;
        const hit = await idbGet(key);
        if (hit?.blob) {
          rememberBlobUrl(key, hit.blob);
          continue;
        }
        await resolveProductImageSrc(product.productImageUrl, product.productImagePath);
      }
    })();
  };

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => run(), { timeout: 2500 });
  } else {
    setTimeout(run, 400);
  }
}
