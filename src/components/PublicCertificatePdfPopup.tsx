import { useEffect, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import { useCertificatePdfPreview } from '../hooks/useCertificatePdfPreview';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import {
  publicCertificateFileName,
  sharePublicCertificatePdf,
  type PublicCertificateHit,
} from '../lib/publicCertificateLookup';

type PublicCertificatePdfPopupProps = {
  hit: PublicCertificateHit | null;
  onClose: () => void;
};

export const PublicCertificatePdfPopup: FC<PublicCertificatePdfPopupProps> = ({
  hit,
  onClose,
}) => {
  const open = Boolean(hit?.pdfUrl);
  const preview = useCertificatePdfPreview({
    enabled: open,
    url: hit?.pdfUrl,
    fileName: hit ? publicCertificateFileName(hit) : 'certificate.pdf',
  });
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');

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
    if (!open) return;
    document.body.classList.add('pcd-pdf-open');
    return () => document.body.classList.remove('pcd-pdf-open');
  }, [open]);

  if (!open || !hit?.pdfUrl || typeof document === 'undefined') return null;

  const title = hit.certificateNumber?.trim() || 'Certificate';
  const error = shareError || preview.error;

  const handleShare = async () => {
    if (sharing || !preview.file) return;
    setSharing(true);
    setShareError('');
    try {
      await sharePublicCertificatePdf(preview.file, title);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setShareError(err instanceof Error ? err.message : 'Share failed.');
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
          disabled={sharing || !preview.file}
          aria-label="Share PDF"
        >
          <Share2 size={18} aria-hidden />
        </button>
      </div>
      <div className="pcd-pdf-body">
        {preview.loading ? <p className="pcd-pdf-status mb-0">Loading certificate…</p> : null}
        {error ? <p className="pcd-pdf-status pcd-pdf-status--err mb-0">{error}</p> : null}
        {preview.useFrame && preview.frameSrc ? (
          <iframe
            className="pcd-pdf-frame"
            src={preview.frameSrc}
            title={title}
          />
        ) : null}
        {preview.pages.map((src, index) => (
          <img
            key={`${title}-${index}`}
            src={src}
            alt={`Certificate page ${index + 1}`}
            className="pcd-pdf-page"
            decoding="async"
            fetchPriority={index === 0 ? 'high' : 'low'}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
};
