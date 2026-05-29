import React, { useEffect, useState } from 'react';
import { clearStorageImageUrlCache, resolveStorageFileUrl, storagePathFromDownloadUrl } from '../lib/storageImageUrl';

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
  ...imgProps
}) => {
  const [src, setSrc] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRetried(false);

    void resolveStorageFileUrl(url, path).then(resolved => {
      if (!cancelled) setSrc(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [url, path]);

  if (!src) return null;

  const handleError = () => {
    const storagePath =
      path?.trim()
      || (url?.includes('firebasestorage.googleapis.com') ? storagePathFromDownloadUrl(url) : null);

    if (!retried && storagePath) {
      setRetried(true);
      clearStorageImageUrlCache(storagePath);
      void resolveStorageFileUrl(null, storagePath, { refresh: true }).then(resolved => {
        if (resolved) setSrc(resolved);
        else onError?.();
      });
      return;
    }
    onError?.();
  };

  return <img {...imgProps} src={src} alt={alt} onError={handleError} />;
};
