import React, { useEffect, useState } from 'react';
import {
  clearStorageImageUrlCache,
  resolveStorageFileUrl,
  storagePathFromDownloadUrl,
} from '../lib/storageImageUrl';
import { resolveProductImageSrc } from '../lib/productImageCache';

type StorageImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError'
> & {
  url?: string | null;
  path?: string | null;
  onError?: () => void;
  /** Persist image bytes on device (IndexedDB) for instant reloads — product thumbs. */
  persistentCache?: boolean;
};

export const StorageImage: React.FC<StorageImageProps> = ({
  url,
  path,
  onError,
  alt = '',
  className,
  persistentCache = false,
  ...imgProps
}) => {
  const directUrl = url?.trim() && /^(https?:|blob:|\/)/i.test(url.trim()) ? url.trim() : null;
  const [src, setSrc] = useState<string | null>(directUrl);
  const [failed, setFailed] = useState(false);
  const [retryStep, setRetryStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setRetryStep(0);
    setSrc(directUrl);

    const resolve = persistentCache
      ? resolveProductImageSrc(url, path)
      : resolveStorageFileUrl(url, path).then(resolved => {
          if (!resolved) return null;
          if (!directUrl) return resolved;
          return directUrl;
        });

    void resolve.then(resolved => {
      if (cancelled || !resolved) return;
      setSrc(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [url, path, directUrl, persistentCache]);

  if (failed) {
    return (
      <span
        className={`storage-image-fallback${className ? ` ${className}` : ''}`}
        role="img"
        aria-label={alt || 'Image unavailable'}
        title={alt || 'Image unavailable'}
      />
    );
  }

  if (!src) return null;

  const handleError = () => {
    const storagePath =
      path?.trim()
      || (url?.includes('firebasestorage.googleapis.com') ? storagePathFromDownloadUrl(url) : null);

    if (retryStep === 0 && storagePath) {
      setRetryStep(1);
      clearStorageImageUrlCache(storagePath);
      const retry = persistentCache
        ? resolveProductImageSrc(url, storagePath)
        : resolveStorageFileUrl(url, storagePath, { refresh: true });
      void retry.then(resolved => {
        if (resolved && resolved !== src) setSrc(resolved);
        else if (directUrl && directUrl !== src) setSrc(directUrl);
        else {
          setFailed(true);
          onError?.();
        }
      });
      return;
    }

    if (retryStep <= 1 && directUrl && src !== directUrl) {
      setRetryStep(2);
      setSrc(directUrl);
      return;
    }

    setFailed(true);
    onError?.();
  };

  return (
    <img
      {...imgProps}
      className={className}
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={handleError}
    />
  );
};
