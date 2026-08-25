import React, { useMemo, useState } from 'react';
import { Download, Printer, Share2 } from 'lucide-react';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import {
  hasSignedCertificatePdf,
  resolveSignedCertificatePdfOnlyPath,
  resolveSignedCertificatePdfOnlyUrl,
  resolveUnsignedCertificatePdfStoragePath,
  resolveUnsignedCertificatePdfUrl,
} from '../lib/signedCertificatePdf';
import {
  printCertificateUrl,
  shareVerificationCertificate,
  withPdfViewerChromeHidden,
} from '../lib/verificationWhatsAppShare';
import { SignedCertificateAvailabilityBadge } from './SignedCertificateAvailabilityBadge';
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
  const hasSigned = hasSignedCertificatePdf(record);
  const [kind, setKind] = useState<PreviewKind>('signed');

  const activeKind: PreviewKind = hasSigned && kind === 'signed' ? 'signed' : 'original';
  const url = activeKind === 'signed' ? signedUrl : originalUrl;
  const storagePath =
    activeKind === 'signed'
      ? resolveSignedCertificatePdfOnlyPath(record)
      : resolveUnsignedCertificatePdfStoragePath(record);

  const frameSrc = useMemo(() => {
    if (!url) return '';
    const isPdf = /\.pdf(\?|$)/i.test(url) || url.includes('firebasestorage');
    return isPdf ? withPdfViewerChromeHidden(url) : url;
  }, [url]);

  if (!show || (!url && !storagePath)) return null;

  const isPdf = Boolean(
    url && (/\.pdf(\?|$)/i.test(url) || url.includes('firebasestorage')),
  );
  const isVoided = isVerificationCertificateVoided(record);
  const title = activeKind === 'signed' ? 'Signed certificate' : 'Certificate';

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
          <SignedCertificateAvailabilityBadge record={record} />
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
          {url ? (
            <>
              <button
                type="button"
                className="verification-certificate-preview-action verification-certificate-preview-action--desktop"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                title="Download PDF"
              >
                <Download size={14} aria-hidden />
                Download
              </button>
              <button
                type="button"
                className="verification-certificate-preview-action verification-certificate-preview-action--desktop"
                onClick={() => printCertificateUrl(url)}
                title="Print"
              >
                <Printer size={14} aria-hidden />
                Print
              </button>
              <button
                type="button"
                className="verification-certificate-preview-action verification-certificate-preview-action--phone"
                onClick={() => void shareVerificationCertificate(record, url)}
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
        {frameSrc ? (
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
