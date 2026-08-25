import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share2, X } from 'lucide-react';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { useMobileViewport } from '../hooks/useMobileViewport';
import {
  certificatePdfFileName,
  downloadCertificatePdfFile,
  fetchCertificatePdfFile,
  renderCertificatePdfPages,
} from '../lib/certificatePdfFile';
import { shareCertificatePdfFile, shareVerificationCertificate } from '../lib/verificationWhatsAppShare';
import type { SiteCalibration } from '../types';

type CertificatePdfShareViewerProps = {
  open: boolean;
  record: SiteCalibration | null;
  url: string | null;
  storagePath?: string | null;
  heading?: string;
  onClose: () => void;
};

export const CertificatePdfShareViewer: React.FC<CertificatePdfShareViewerProps> = ({
  open,
  record,
  url,
  storagePath,
  heading,
  onClose,
}) => {
  const [pages, setPages] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [useFrame, setUseFrame] = useState(false);
  const isPhone = useMobileViewport();

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open || !record || (!url && !storagePath)) {
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
        const pdfFile = await fetchCertificatePdfFile(
          url || '',
          certificatePdfFileName(record),
          storagePath,
        );
        const images = await renderCertificatePdfPages(pdfFile);
        if (cancelled) return;
        setFile(pdfFile);
        setPages(images);
      } catch (err) {
        if (cancelled) return;
        if (url) {
          setUseFrame(true);
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
    };
  }, [open, url, storagePath, record]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('wl-cert-pdf-viewer-open');
    return () => document.body.classList.remove('wl-cert-pdf-viewer-open');
  }, [open]);

  if (!open || !record || typeof document === 'undefined') return null;

  const title = heading?.trim()
    || (record.certificateNumber?.trim() ? record.certificateNumber.trim() : 'Certificate');

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    setError('');
    try {
      if (file) {
        await shareCertificatePdfFile(file, title);
        return;
      }
      await shareVerificationCertificate(record, url);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setSharing(false);
    }
  };

  const handleDownload = async () => {
    if (sharing) return;
    setSharing(true);
    setError('');
    try {
      if (file) {
        downloadCertificatePdfFile(file);
        return;
      }
      const pdfFile = await fetchCertificatePdfFile(
        url || '',
        certificatePdfFileName(record),
        storagePath,
      );
      setFile(pdfFile);
      downloadCertificatePdfFile(pdfFile);
    } catch (err) {
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setSharing(false);
    }
  };

  return createPortal(
    <div className="wl-cert-pdf-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <header className="wl-cert-pdf-viewer__bar">
        <h2 className="wl-cert-pdf-viewer__title">{title}</h2>
        <div className="wl-cert-pdf-viewer__actions">
          <button
            type="button"
            className="wl-cert-pdf-viewer__close"
            onClick={onClose}
          >
            <X size={18} strokeWidth={2.2} aria-hidden />
            Close
          </button>
          <button
            type="button"
            className="wl-cert-pdf-viewer__share"
            onClick={() => void (isPhone ? handleShare() : handleDownload())}
            disabled={sharing || (!file && !url && !storagePath)}
            aria-label={isPhone ? 'Share certificate' : 'Download certificate'}
            title={isPhone ? 'Share' : 'Download'}
          >
            {isPhone ? (
              <Share2 size={18} strokeWidth={2} aria-hidden />
            ) : (
              <Download size={18} strokeWidth={2} aria-hidden />
            )}
            {isPhone ? 'Share' : 'Download'}
          </button>
        </div>
      </header>
      <div className="wl-cert-pdf-viewer__body">
        {loading ? <p className="wl-cert-pdf-viewer__status">Loading certificate…</p> : null}
        {error ? <p className="wl-cert-pdf-viewer__status wl-cert-pdf-viewer__status--err">{error}</p> : null}
        {useFrame && url ? (
          <iframe
            className="wl-cert-pdf-viewer__frame"
            src={url}
            title={title}
          />
        ) : null}
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
