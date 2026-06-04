import React from 'react';
import { ExternalLink } from 'lucide-react';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { resolveCertificatePreviewUrl } from '../lib/verificationCertifiedActions';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
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
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="verification-certificate-preview-open"
        >
          Open <ExternalLink size={14} aria-hidden />
        </a>
      </div>
      <div className="verification-certificate-preview-frame">
        {isPdf ? (
          <iframe
            src={url}
            title={`Certificate for ${record.serialNumber || 'verification'}`}
            className="verification-certificate-preview-iframe"
          />
        ) : (
          <iframe
            src={url}
            title={`Certificate for ${record.serialNumber || 'verification'}`}
            className="verification-certificate-preview-iframe"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        )}
        {isVoided && <VerificationVoidWatermark variant="certificate" />}
      </div>
    </aside>
  );
};
