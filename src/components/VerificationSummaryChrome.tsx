import React from 'react';
import { Barcode, Building2, ShieldCheck, UserRound } from 'lucide-react';
import { verificationZohoInvoiceNumber } from '../lib/zohoRvSubmit';
import {
  getVerificationDisplayStatus,
  verificationDisplayStatusLabel,
} from '../lib/verificationRequest';
import type { SiteCalibration } from '../types';

type VerificationSummaryChromeProps = {
  record: SiteCalibration;
  rcCenterName?: string;
  versionHint?: string;
};

function headerRefLines(record: SiteCalibration): { key: string; line: string }[] {
  const refs: { key: string; line: string }[] = [];
  const app = record.applicationNumber?.trim();
  const cert = record.certificateNumber?.trim();
  const zohoInvoice = verificationZohoInvoiceNumber(record);
  if (app) refs.push({ key: 'app', line: `App No. ${app}` });
  if (zohoInvoice) refs.push({ key: 'zoho', line: `Zoho ${zohoInvoice}` });
  if (cert) refs.push({ key: 'cert', line: cert });
  return refs;
}

export const VerificationSummaryChrome: React.FC<VerificationSummaryChromeProps> = ({
  record,
  rcCenterName,
  versionHint,
}) => {
  const statusKey = getVerificationDisplayStatus(record);
  const statusLabel = verificationDisplayStatusLabel(record).toUpperCase();
  const refs = headerRefLines(record);
  const serial = record.serialNumber?.trim() || '—';
  const customer = record.customerName?.trim() || '—';

  return (
    <div className="verification-ref-chrome">
      <header className="verification-ref-header">
        <div className="verification-ref-header-leading">
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
            {versionHint && <p className="verification-ref-version-hint mb-0">{versionHint}</p>}
          </div>
        </div>
        {refs.length > 0 && (
          <div className="verification-ref-status-refs">
            {refs.map(ref => (
              <span key={ref.key} className="verification-ref-status-ref text-mono">
                {ref.line}
              </span>
            ))}
          </div>
        )}
      </header>

      {rcCenterName?.trim() && (
        <div className="verification-ref-rc-centre" aria-label="RC centre">
          <span className="verification-ref-rc-centre-icon" aria-hidden>
            <Building2 size={16} strokeWidth={2} />
          </span>
          <div className="verification-ref-rc-centre-body">
            <span className="verification-ref-rc-centre-label">RC centre</span>
            <span className="verification-ref-rc-centre-value">{rcCenterName.trim()}</span>
          </div>
        </div>
      )}

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
