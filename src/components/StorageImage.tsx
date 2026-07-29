import React, { useEffect, useState } from 'react';
import {
  clearStorageImageUrlCache,
  resolveStorageFileUrl,
  storagePathFromDownloadUrl,
} from '../lib/storageImageUrl';

type StorageImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'onError'
> & {
  url?: string | null;
  path?: string | null;
  onError?: () => void;
};

export const StorageImage: React.FC<StorageImageProps> = ({
  url,
  path,
  onError,
  alt = '',
  className,
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
    // Show stored URL immediately — do not block on getDownloadURL.
    setSrc(directUrl);

    void resolveStorageFileUrl(url, path).then(resolved => {
      if (cancelled || !resolved) return;
      // Keep direct URL unless resolve produced something different after refresh path.
      if (!directUrl) setSrc(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [url, path, directUrl]);

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

    // 1) Fresh download URL from Storage path
    if (retryStep === 0 && storagePath) {
      setRetryStep(1);
      clearStorageImageUrlCache(storagePath);
      void resolveStorageFileUrl(url, storagePath, { refresh: true }).then(resolved => {
        if (resolved && resolved !== src) setSrc(resolved);
        else if (directUrl && directUrl !== src) setSrc(directUrl);
        else {
          setFailed(true);
          onError?.();
        }
      });
      return;
    }

    // 2) Original Firestore download URL
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
