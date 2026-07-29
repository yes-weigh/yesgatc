import { getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage';
import { legacyStorage, storage } from '../firebase';

const urlCache = new Map<string, string>();

const storageBackends: FirebaseStorage[] = [storage, legacyStorage];

function isDirectImageUrl(value: string): boolean {
  return (
    value.startsWith('blob:')
    || value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('/')
  );
}

function isStorageObjectPath(value: string): boolean {
  return value.includes('/') && !isDirectImageUrl(value);
}

export function storagePathFromDownloadUrl(url: string): string | null {
  try {
    const match = url.match(/\/o\/([^?]+)/);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

function cacheKey(storagePath: string, bucketUrl: string): string {
  return `${bucketUrl}::${storagePath}`;
}

async function resolvePathFromBuckets(
  storagePath: string,
  refresh?: boolean,
): Promise<string | null> {
  for (const backend of storageBackends) {
    const key = cacheKey(storagePath, backend.app.options.storageBucket ?? 'default');
    if (!refresh && urlCache.has(key)) {
      return urlCache.get(key)!;
    }

    try {
      const resolved = await getDownloadURL(ref(backend, storagePath));
      urlCache.set(key, resolved);
      return resolved;
    } catch {
      if (refresh) {
        urlCache.delete(key);
      }
    }
  }

  return null;
}

/**
 * Resolve a displayable image URL.
 * Prefer the stored https download URL (works without SDK). Re-resolve via path only
 * when URL is missing or caller asks for a refresh after a load error.
 */
export async function resolveStorageFileUrl(
  url?: string | null,
  path?: string | null,
  options?: { refresh?: boolean },
): Promise<string | null> {
  const trimmedUrl = url?.trim() ?? '';
  let storagePath = path?.trim() ?? '';

  if (!storagePath && trimmedUrl.includes('firebasestorage.googleapis.com')) {
    storagePath = storagePathFromDownloadUrl(trimmedUrl) ?? '';
  }

  // Fast path: use the Firestore download URL as-is (token already embedded).
  if (!options?.refresh && trimmedUrl && isDirectImageUrl(trimmedUrl)) {
    return trimmedUrl;
  }

  if (storagePath) {
    const resolved = await resolvePathFromBuckets(storagePath, options?.refresh);
    if (resolved) return resolved;
  }

  // After a failed refresh, still fall back to the original download URL.
  if (trimmedUrl && isDirectImageUrl(trimmedUrl)) {
    return trimmedUrl;
  }

  if (trimmedUrl && isStorageObjectPath(trimmedUrl)) {
    return resolvePathFromBuckets(trimmedUrl, options?.refresh);
  }

  return null;
}

export function clearStorageImageUrlCache(storagePath?: string): void {
  if (!storagePath) {
    urlCache.clear();
    return;
  }

  for (const backend of storageBackends) {
    const key = cacheKey(storagePath, backend.app.options.storageBucket ?? 'default');
    urlCache.delete(key);
  }
}
