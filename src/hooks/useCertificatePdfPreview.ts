import { useEffect, useRef, useState } from 'react';
import {
  canUseNativePdfFrame,
  fetchCertificatePdfFile,
  renderCertificatePdfPages,
  revokeCertificatePdfUrl,
} from '../lib/certificatePdfFile';
import { withPdfViewerChromeHidden } from '../lib/verificationWhatsAppShare';

type UseCertificatePdfPreviewArgs = {
  enabled: boolean;
  url: string | null | undefined;
  storagePath?: string | null;
  fileName: string;
};

export function useCertificatePdfPreview({
  enabled,
  url,
  storagePath,
  fileName,
}: UseCertificatePdfPreviewArgs) {
  const [pages, setPages] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [frameSrc, setFrameSrc] = useState('');
  const pageUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const clearPages = () => {
      for (const pageUrl of pageUrlsRef.current) revokeCertificatePdfUrl(pageUrl);
      pageUrlsRef.current = [];
      setPages([]);
    };

    if (!enabled || (!url && !storagePath)) {
      clearPages();
      setFile(null);
      setError('');
      setFrameSrc('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    clearPages();
    setFile(null);
    setError('');
    setFrameSrc('');
    setLoading(true);

    const pushPage = (pageUrl: string) => {
      if (cancelled) {
        revokeCertificatePdfUrl(pageUrl);
        return;
      }
      pageUrlsRef.current = [...pageUrlsRef.current, pageUrl];
      setPages(pageUrlsRef.current);
      setLoading(false);
    };

    void (async () => {
      try {
        if (canUseNativePdfFrame() && url) {
          setFrameSrc(withPdfViewerChromeHidden(url));
          setLoading(false);
          const pdfFile = await fetchCertificatePdfFile(url, fileName, storagePath);
          if (!cancelled) setFile(pdfFile);
          return;
        }

        const pdfFile = await fetchCertificatePdfFile(url || '', fileName, storagePath);
        if (cancelled) return;
        setFile(pdfFile);
        await renderCertificatePdfPages(pdfFile, pageUrl => pushPage(pageUrl));
      } catch (err) {
        if (cancelled) return;
        if (url) {
          setFrameSrc(withPdfViewerChromeHidden(url));
          setError('');
          return;
        }
        setError(err instanceof Error ? err.message : 'Could not open certificate.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearPages();
    };
  }, [enabled, url, storagePath, fileName]);

  return {
    pages,
    file,
    loading,
    error,
    frameSrc,
    useFrame: Boolean(frameSrc) && pages.length === 0,
  };
}
