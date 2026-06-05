import React from 'react';
import { Barcode, ShieldCheck, UserRound } from 'lucide-react';
import {
  getVerificationDisplayStatus,
  verificationDisplayStatusLabel,
} from '../lib/verificationRequest';
import type { SiteCalibration } from '../types';

type VerificationSummaryChromeProps = {
  record: SiteCalibration;
  versionHint?: string;
};

function headerSubtitle(record: SiteCalibration): string {
  const parts: string[] = [];
  const app = record.applicationNumber?.trim();
  const cert = record.certificateNumber?.trim();
  if (app) parts.push(`App ${app}`);
  if (cert) parts.push(cert);
  return parts.join(' • ');
}

export const VerificationSummaryChrome: React.FC<VerificationSummaryChromeProps> = ({
  record,
  versionHint,
}) => {
  const statusKey = getVerificationDisplayStatus(record);
  const statusLabel = verificationDisplayStatusLabel(record).toUpperCase();
  const subtitle = headerSubtitle(record);
  const serial = record.serialNumber?.trim() || '—';
  const customer = record.customerName?.trim() || '—';

  return (
    <div className="verification-ref-chrome">
      <header className="verification-ref-header">
        <div className="verification-ref-header-main">
          <span
            className={`verification-ref-status-icon verification-ref-status-icon--${statusKey}`}
            aria-hidden
          >
            <ShieldCheck size={26} strokeWidth={2} />
          </span>
          <div className="verification-ref-header-text">
            <h2 className={`verification-ref-status-title verification-ref-status-title--${statusKey}`}>
              {statusLabel}
            </h2>
            {subtitle && <p className="verification-ref-status-sub text-mono mb-0">{subtitle}</p>}
            {versionHint && <p className="verification-ref-version-hint mb-0">{versionHint}</p>}
          </div>
        </div>
      </header>

      <div className="verification-ref-identity" aria-label="Serial and customer">
        <div className="verification-ref-identity-item">
          <span className="verification-ref-identity-icon verification-ref-identity-icon--serial" aria-hidden>
            <Barcode size={18} strokeWidth={2} />
          </span>
          <div className="verification-ref-identity-body">
            <span className="verification-ref-identity-label">Serial number</span>
            <span className="verification-ref-identity-value text-mono">{serial}</span>
          </div>
        </div>
        <div className="verification-ref-identity-divider" aria-hidden />
        <div className="verification-ref-identity-item">
          <span className="verification-ref-identity-icon verification-ref-identity-icon--customer" aria-hidden>
            <UserRound size={18} strokeWidth={2} />
          </span>
          <div className="verification-ref-identity-body">
            <span className="verification-ref-identity-label">Customer name</span>
            <span className="verification-ref-identity-value">{customer}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
