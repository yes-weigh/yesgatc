import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import {
  certificatePdfFileName,
  fetchCertificatePdfFile,
  renderCertificatePdfPages,
} from '../lib/certificatePdfFile';
import { shareCertificatePdfFile } from '../lib/verificationWhatsAppShare';
import type { SiteCalibration } from '../types';

type CertificatePdfShareViewerProps = {
  open: boolean;
  record: SiteCalibration | null;
  url: string | null;
  onClose: () => void;
};

export const CertificatePdfShareViewer: React.FC<CertificatePdfShareViewerProps> = ({
  open,
  record,
  url,
  onClose,
}) => {
  const [pages, setPages] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open || !url || !record) {
      setPages([]);
      setFile(null);
      setError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    setPages([]);
    setFile(null);

    void (async () => {
      try {
        const pdfFile = await fetchCertificatePdfFile(url, certificatePdfFileName(record));
        const images = await renderCertificatePdfPages(pdfFile);
        if (cancelled) return;
        setFile(pdfFile);
        setPages(images);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not open certificate.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, url, record]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('wl-cert-pdf-viewer-open');
    return () => document.body.classList.remove('wl-cert-pdf-viewer-open');
  }, [open]);

  if (!open || !record || typeof document === 'undefined') return null;

  const title = record.certificateNumber?.trim() || 'Certificate';

  const handleShare = async () => {
    if (!file || sharing) return;
    setSharing(true);
    setError('');
    try {
      await shareCertificatePdfFile(file, title);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div className="wl-cert-pdf-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <header className="wl-cert-pdf-viewer__bar">
        <button
          type="button"
          className="wl-cert-pdf-viewer__icon-btn"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={22} strokeWidth={2} aria-hidden />
        </button>
        <h2 className="wl-cert-pdf-viewer__title">{title}</h2>
        <button
          type="button"
          className="wl-cert-pdf-viewer__share"
          onClick={() => void handleShare()}
          disabled={!file || sharing}
        >
          <Share2 size={18} strokeWidth={2} aria-hidden />
          Share
        </button>
      </header>
      <div className="wl-cert-pdf-viewer__body">
        {loading ? <p className="wl-cert-pdf-viewer__status">Loading certificate…</p> : null}
        {error ? <p className="wl-cert-pdf-viewer__status wl-cert-pdf-viewer__status--err">{error}</p> : null}
        {pages.map((src, index) => (
          <img
            key={`${title}-${index}`}
            src={src}
            alt={`Certificate page ${index + 1}`}
            className="wl-cert-pdf-viewer__page"
          />
        ))}
      </div>
    </div>,
    document.body,
  );
};
