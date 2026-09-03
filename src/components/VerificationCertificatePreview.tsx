import { useState, type FC } from 'react';
import { Download, Printer, Share2 } from 'lucide-react';
import { useCertificatePdfPreview } from '../hooks/useCertificatePdfPreview';
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
} from '../lib/certificatePdfFile';
import {
  printCertificateUrl,
  shareCertificatePdfFile,
  shareVerificationCertificate,
} from '../lib/verificationWhatsAppShare';
import { isPhoneShareDevice } from '../lib/imageCapture';
import { VerificationVoidWatermark } from './VerificationVoidWatermark';
import type { SiteCalibration } from '../types';

type PreviewKind = 'signed' | 'original';

type VerificationCertificatePreviewProps = {
  record: SiteCalibration;
  className?: string;
};

export const VerificationCertificatePreview: FC<VerificationCertificatePreviewProps> = ({
  record,
  className = '',
}) => {
  const show = canShowVerificationCertifiedActions(record);
  const signedUrl = resolveSignedCertificatePdfOnlyUrl(record);
  const originalUrl = resolveUnsignedCertificatePdfUrl(record);
  const hasSigned = canShowSignedCertificatePdf(record);
  const [kind, setKind] = useState<PreviewKind>('signed');

  const activeKind: PreviewKind = hasSigned && kind === 'signed' ? 'signed' : 'original';
  const url = activeKind === 'signed' ? signedUrl : originalUrl;
  const storagePath =
    activeKind === 'signed'
      ? resolveSignedCertificatePdfOnlyPath(record)
      : resolveUnsignedCertificatePdfStoragePath(record);

  const preview = useCertificatePdfPreview({
    enabled: show && Boolean(url || storagePath),
    url,
    storagePath,
    fileName: certificatePdfFileName(record),
  });

  if (!show || (!url && !storagePath)) return null;

  const isPdf = Boolean(
    url && (/\.pdf(\?|$)/i.test(url) || url.includes('firebasestorage')),
  );
  const isVoided = isVerificationCertificateVoided(record);
  const title = activeKind === 'signed' ? 'Signed certificate' : 'Certificate';
  const isPhone = isPhoneShareDevice();

  const handleShare = async () => {
    if (preview.file) {
      await shareCertificatePdfFile(preview.file, title);
      return;
    }
    if (url) await shareVerificationCertificate(record, url);
  };

  const handleDownload = () => {
    if (preview.file) {
      downloadCertificatePdfFile(preview.file);
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
          {url || preview.file ? (
            isPhone ? (
              <button
                type="button"
                className="verification-certificate-preview-action"
                onClick={() => void handleShare()}
                title="Share"
              >
                <Share2 size={14} aria-hidden />
                Share
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="verification-certificate-preview-action"
                  onClick={handleDownload}
                  title="Download PDF"
                >
                  <Download size={14} aria-hidden />
                  Download
                </button>
                <button
                  type="button"
                  className="verification-certificate-preview-action"
                  onClick={() => url && printCertificateUrl(url)}
                  title="Print"
                >
                  <Printer size={14} aria-hidden />
                  Print
                </button>
              </>
            )
          ) : null}
        </div>
      </div>
      <div className="verification-certificate-preview-frame">
        {preview.loading ? (
          <p className="verification-certificate-preview-status mb-0">Loading certificate…</p>
        ) : null}
        {preview.pages.length > 0 ? (
          <div className="verification-certificate-preview-pages">
            {preview.pages.map((src, index) => (
              <img
                key={`${title}-${index}`}
                src={src}
                alt={`Certificate page ${index + 1}`}
                className="verification-certificate-preview-page"
                decoding="async"
                fetchPriority={index === 0 ? 'high' : 'low'}
              />
            ))}
          </div>
        ) : null}
        {preview.useFrame && preview.frameSrc ? (
          <iframe
            src={preview.frameSrc}
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
