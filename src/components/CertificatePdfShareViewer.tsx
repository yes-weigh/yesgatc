import { useEffect, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share2, X } from 'lucide-react';
import { useCertificatePdfPreview } from '../hooks/useCertificatePdfPreview';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { useMobileViewport } from '../hooks/useMobileViewport';
import {
  certificatePdfFileName,
  downloadCertificatePdfFile,
  fetchCertificatePdfFile,
} from '../lib/certificatePdfFile';
import { certificateSignStatus } from '../lib/signedCertificatePdf';
import { shareCertificatePdfFile, shareVerificationCertificate } from '../lib/verificationWhatsAppShare';
import type { SiteCalibration } from '../types';
import { UnsignedCertificateDownloadWarn } from './RcUnsignedPdfDisturbHost';

type CertificatePdfShareViewerProps = {
  open: boolean;
  record: SiteCalibration | null;
  url: string | null;
  storagePath?: string | null;
  heading?: string;
  /** Popup + sound before download when certificate is not signed. */
  warnUnsignedDownload?: boolean;
  onClose: () => void;
};

export const CertificatePdfShareViewer: FC<CertificatePdfShareViewerProps> = ({
  open,
  record,
  url,
  storagePath,
  heading,
  warnUnsignedDownload = false,
  onClose,
}) => {
  const isPhone = useMobileViewport();
  const fileName = record ? certificatePdfFileName(record) : 'certificate.pdf';
  const preview = useCertificatePdfPreview({
    enabled: open && Boolean(record),
    url,
    storagePath,
    fileName,
  });
  const [sharing, setSharing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [downloadWarnOpen, setDownloadWarnOpen] = useState(false);

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('wl-cert-pdf-viewer-open');
    return () => document.body.classList.remove('wl-cert-pdf-viewer-open');
  }, [open]);

  useEffect(() => {
    if (!open) setDownloadWarnOpen(false);
  }, [open]);

  if (!open || !record || typeof document === 'undefined') return null;

  const title = heading?.trim()
    || (record.certificateNumber?.trim() ? record.certificateNumber.trim() : 'Certificate');
  const error = actionError || preview.error;
  const needsUnsignedWarn =
    warnUnsignedDownload && certificateSignStatus(record) === 'not_signed';

  const runDownload = async () => {
    if (sharing) return;
    setSharing(true);
    setActionError('');
    try {
      if (preview.file) {
        downloadCertificatePdfFile(preview.file);
        return;
      }
      const pdfFile = await fetchCertificatePdfFile(url || '', fileName, storagePath);
      downloadCertificatePdfFile(pdfFile);
    } catch (err) {
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      setActionError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setSharing(false);
    }
  };

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    setActionError('');
    try {
      if (preview.file) {
        await shareCertificatePdfFile(preview.file, title);
        return;
      }
      await shareVerificationCertificate(record, url);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setActionError(err instanceof Error ? err.message : 'Share failed.');
    } finally {
      setSharing(false);
    }
  };

  const handleDownload = () => {
    if (needsUnsignedWarn) {
      setDownloadWarnOpen(true);
      return;
    }
    void runDownload();
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
            disabled={sharing || (!preview.file && !url && !storagePath)}
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
        {preview.loading ? <p className="wl-cert-pdf-viewer__status">Loading certificate…</p> : null}
        {error ? <p className="wl-cert-pdf-viewer__status wl-cert-pdf-viewer__status--err">{error}</p> : null}
        {preview.useFrame && preview.frameSrc ? (
          <iframe
            className="wl-cert-pdf-viewer__frame"
            src={preview.frameSrc}
            title={title}
          />
        ) : null}
        {preview.pages.map((src, index) => (
          <img
            key={`${title}-${index}`}
            src={src}
            alt={`Certificate page ${index + 1}`}
            className="wl-cert-pdf-viewer__page"
            decoding="async"
            fetchPriority={index === 0 ? 'high' : 'low'}
          />
        ))}
      </div>
      <UnsignedCertificateDownloadWarn
        open={downloadWarnOpen}
        onContinue={() => {
          setDownloadWarnOpen(false);
          void runDownload();
        }}
        onCancel={() => setDownloadWarnOpen(false)}
      />
    </div>,
    document.body,
  );
};
