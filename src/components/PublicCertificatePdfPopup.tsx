import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { renderCertificatePdfPages } from '../lib/certificatePdfFile';
import {
  publicCertificateFileName,
  sharePublicCertificatePdf,
  type PublicCertificateHit,
} from '../lib/publicCertificateLookup';
import { withPdfViewerChromeHidden } from '../lib/verificationWhatsAppShare';

type PublicCertificatePdfPopupProps = {
  hit: PublicCertificateHit | null;
  onClose: () => void;
};

async function fetchPublicPdfFile(url: string, fileName: string): Promise<File> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load PDF.');
  const blob = await response.blob();
  return new File([blob], fileName, { type: 'application/pdf' });
}

export const PublicCertificatePdfPopup: React.FC<PublicCertificatePdfPopupProps> = ({
  hit,
  onClose,
}) => {
  const open = Boolean(hit?.pdfUrl);
  const [pages, setPages] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [useFrame, setUseFrame] = useState(false);
  const [error, setError] = useState('');

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !hit?.pdfUrl) {
      setPages([]);
      setFile(null);
      setError('');
      setUseFrame(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    setPages([]);
    setFile(null);
    setUseFrame(false);

    void (async () => {
      try {
        const pdfFile = await fetchPublicPdfFile(hit.pdfUrl!, publicCertificateFileName(hit));
        const images = await renderCertificatePdfPages(pdfFile);
        if (cancelled) return;
        setFile(pdfFile);
        setPages(images);
      } catch {
        if (cancelled) return;
        setUseFrame(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, hit]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('pcd-pdf-open');
    return () => document.body.classList.remove('pcd-pdf-open');
  }, [open]);

  if (!open || !hit?.pdfUrl || typeof document === 'undefined') return null;

  const title = hit.certificateNumber?.trim() || 'Certificate';

  const handleShare = async () => {
    if (sharing || !file) return;
    setSharing(true);
    setError('');
    try {
      await sharePublicCertificatePdf(file, title);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div className="pcd-pdf" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pcd-pdf-chrome">
        <button
          type="button"
          className="pcd-pdf-box pcd-pdf-box--close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} aria-hidden />
        </button>
        <button
          type="button"
          className="pcd-pdf-box pcd-pdf-box--share"
          onClick={() => void handleShare()}
          disabled={sharing || !file}
          aria-label="Share PDF"
        >
          <Share2 size={18} aria-hidden />
        </button>
      </div>
      <div className="pcd-pdf-body">
        {loading ? <p className="pcd-pdf-status mb-0">Loading certificate…</p> : null}
        {error ? <p className="pcd-pdf-status pcd-pdf-status--err mb-0">{error}</p> : null}
        {useFrame ? (
          <iframe
            className="pcd-pdf-frame"
            src={withPdfViewerChromeHidden(hit.pdfUrl)}
            title={title}
          />
        ) : null}
        {pages.map((src, index) => (
          <img
            key={`${title}-${index}`}
            src={src}
            alt={`Certificate page ${index + 1}`}
            className="pcd-pdf-page"
          />
        ))}
      </div>
    </div>,
    document.body,
  );
};
