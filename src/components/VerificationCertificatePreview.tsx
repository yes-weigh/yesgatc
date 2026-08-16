import React from 'react';
import { Download, Printer, Share2 } from 'lucide-react';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { resolveCertificatePreviewUrl } from '../lib/verificationCertifiedActions';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import {
  printCertificateUrl,
  shareVerificationCertificate,
  withPdfViewerChromeHidden,
} from '../lib/verificationWhatsAppShare';
import { VerificationVoidWatermark } from './VerificationVoidWatermark';
import type { SiteCalibration } from '../types';

type VerificationCertificatePreviewProps = {
  record: SiteCalibration;
  className?: string;
};

export const VerificationCertificatePreview: React.FC<VerificationCertificatePreviewProps> = ({
  record,
  className = '',
}) => {
  if (!canShowVerificationCertifiedActions(record)) return null;

  const url = resolveCertificatePreviewUrl(record);
  if (!url) return null;

  const isPdf = /\.pdf(\?|$)/i.test(url) || url.includes('firebasestorage');
  const frameSrc = isPdf ? withPdfViewerChromeHidden(url) : url;
  const isVoided = isVerificationCertificateVoided(record);

  return (
    <aside
      className={`verification-certificate-preview${isVoided ? ' verification-certificate-preview--voided' : ''}${
        className ? ` ${className}` : ''
      }`}
      aria-label="Certificate preview"
    >
      <div className="verification-certificate-preview-head">
        <h4 className="verification-certificate-preview-title">Certificate</h4>
        <div className="verification-certificate-preview-actions">
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
        </div>
      </div>
      <div className="verification-certificate-preview-frame">
        <iframe
          src={frameSrc}
          title={`Certificate for ${record.serialNumber || 'verification'}`}
          className="verification-certificate-preview-iframe"
          {...(isPdf ? {} : { sandbox: 'allow-scripts allow-same-origin allow-popups' })}
        />
        {isVoided && <VerificationVoidWatermark variant="certificate" />}
      </div>
    </aside>
  );
};
