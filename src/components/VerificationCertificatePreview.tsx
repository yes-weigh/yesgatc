import React, { useEffect, useState } from 'react';
import { Download, Printer, Share2 } from 'lucide-react';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import {
  canShowSignedCertificatePdf,
  resolveSignedCertificatePdfOnlyPath,
  resolveSignedCertificatePdfOnlyUrl,
  resolveUnsignedCertificatePdfStoragePath,
  resolveUnsignedCertificatePdfUrl,
} from '../lib/signedCertificatePdf';
import {
  certificatePdfFileName,
  downloadCertificatePdfFile,
  fetchCertificatePdfFile,
  renderCertificatePdfPages,
} from '../lib/certificatePdfFile';
import {
  printCertificateUrl,
  shareCertificatePdfFile,
  shareVerificationCertificate,
  withPdfViewerChromeHidden,
} from '../lib/verificationWhatsAppShare';
import { VerificationVoidWatermark } from './VerificationVoidWatermark';
import type { SiteCalibration } from '../types';

type PreviewKind = 'signed' | 'original';

type VerificationCertificatePreviewProps = {
  record: SiteCalibration;
  className?: string;
};

export const VerificationCertificatePreview: React.FC<VerificationCertificatePreviewProps> = ({
  record,
  className = '',
}) => {
  const show = canShowVerificationCertifiedActions(record);
  const signedUrl = resolveSignedCertificatePdfOnlyUrl(record);
  const originalUrl = resolveUnsignedCertificatePdfUrl(record);
  const hasSigned = canShowSignedCertificatePdf(record);
  const [kind, setKind] = useState<PreviewKind>('signed');
  const [pages, setPages] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [useFrame, setUseFrame] = useState(false);

  const activeKind: PreviewKind = hasSigned && kind === 'signed' ? 'signed' : 'original';
  const url = activeKind === 'signed' ? signedUrl : originalUrl;
  const storagePath =
    activeKind === 'signed'
      ? resolveSignedCertificatePdfOnlyPath(record)
      : resolveUnsignedCertificatePdfStoragePath(record);

  useEffect(() => {
    if (!show || (!url && !storagePath)) {
      setPages([]);
      setFile(null);
      setUseFrame(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
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
      } catch {
        if (cancelled) return;
        setUseFrame(Boolean(url));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [show, url, storagePath, record.id, record.certificateNumber]);

  if (!show || (!url && !storagePath)) return null;

  const isPdf = Boolean(
    url && (/\.pdf(\?|$)/i.test(url) || url.includes('firebasestorage')),
  );
  const isVoided = isVerificationCertificateVoided(record);
  const title = activeKind === 'signed' ? 'Signed certificate' : 'Certificate';
  const frameSrc =
    url && (isPdf ? withPdfViewerChromeHidden(url) : url);

  const handleShare = async () => {
    if (file) {
      await shareCertificatePdfFile(file, title);
      return;
    }
    if (url) await shareVerificationCertificate(record, url);
  };

  const handleDownload = () => {
    if (file) {
      downloadCertificatePdfFile(file);
      return;
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <aside
      className={`verification-certificate-preview${isVoided ? ' verification-certificate-preview--voided' : ''}${
        className ? ` ${className}` : ''
      }`}
      aria-label="Certificate preview"
    >
      <div className="verification-certificate-preview-head">
        <div className="verification-certificate-preview-heading">
          <h4 className="verification-certificate-preview-title">{title}</h4>
        </div>
        <div className="verification-certificate-preview-actions">
          {hasSigned && originalUrl ? (
            <div className="verification-certificate-preview-switch" role="group" aria-label="Certificate file">
              <button
                type="button"
                className={`verification-certificate-preview-switch-btn${
                  activeKind === 'signed' ? ' is-on' : ''
                }`}
                onClick={() => setKind('signed')}
              >
                Signed
              </button>
              <button
                type="button"
                className={`verification-certificate-preview-switch-btn${
                  activeKind === 'original' ? ' is-on' : ''
                }`}
                onClick={() => setKind('original')}
              >
                Original
              </button>
            </div>
          ) : null}
          {url || file ? (
            <>
              <button
                type="button"
                className="verification-certificate-preview-action verification-certificate-preview-action--desktop"
                onClick={handleDownload}
                title="Download PDF"
              >
                <Download size={14} aria-hidden />
                Download
              </button>
              <button
                type="button"
                className="verification-certificate-preview-action verification-certificate-preview-action--desktop"
                onClick={() => url && printCertificateUrl(url)}
                title="Print"
              >
                <Printer size={14} aria-hidden />
                Print
              </button>
              <button
                type="button"
                className="verification-certificate-preview-action verification-certificate-preview-action--phone"
                onClick={() => void handleShare()}
                title="Share"
              >
                <Share2 size={14} aria-hidden />
                Share
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="verification-certificate-preview-frame">
        {loading ? (
          <p className="verification-certificate-preview-status mb-0">Loading certificate…</p>
        ) : null}
        {pages.length > 0 ? (
          <div className="verification-certificate-preview-pages">
            {pages.map((src, index) => (
              <img
                key={`${title}-${index}`}
                src={src}
                alt={`Certificate page ${index + 1}`}
                className="verification-certificate-preview-page"
              />
            ))}
          </div>
        ) : null}
        {useFrame && frameSrc ? (
          <iframe
            src={frameSrc}
            title={`${title} for ${record.serialNumber || 'verification'}`}
            className="verification-certificate-preview-iframe"
            {...(isPdf ? {} : { sandbox: 'allow-scripts allow-same-origin allow-popups' })}
          />
        ) : null}
        {isVoided && <VerificationVoidWatermark variant="certificate" />}
      </div>
    </aside>
  );
};
