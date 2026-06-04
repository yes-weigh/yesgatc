import React from 'react';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { VerificationVoidWatermark } from './VerificationVoidWatermark';
import { VERIFICATION_LOCATION_OPTIONS, verificationTypeLabel } from '../lib/siteCalibrationProfileFields';
import { formatVerificationListDate } from '../lib/verificationListFormat';
import { formatVerificationCapAcc, verificationVctLabel } from '../lib/verificationRequest';
import type { SiteCalibration } from '../types';

type VerificationDetailsCardProps = {
  record: SiteCalibration;
  className?: string;
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="verification-summary-detail-row">
      <span className="verification-summary-detail-label">{label}</span>
      <span className="verification-summary-detail-value">{value}</span>
    </div>
  );
}

function locationLabel(value?: SiteCalibration['verificationLocation']): string | null {
  if (!value) return null;
  return VERIFICATION_LOCATION_OPTIONS.find(opt => opt.value === value)?.label ?? value;
}

function subjectLabel(record: SiteCalibration): string {
  if (record.verificationSubject === 'self') return 'Self';
  if (record.verificationSubject === 'customer') return 'Customer';
  return '—';
}

export const VerificationDetailsCard: React.FC<VerificationDetailsCardProps> = ({
  record,
  className = '',
}) => {
  const verifiedOn = record.certifiedAt || record.approvedAt || record.submittedAt;
  const mpe =
    record.maximumPermissibleError != null ? `${record.maximumPermissibleError} g` : null;
  const isVoided = isVerificationCertificateVoided(record);

  return (
    <section
      className={`verification-summary-details-card${isVoided ? ' verification-summary-details-card--voided' : ''}${
        className ? ` ${className}` : ''
      }`}
      aria-labelledby="verification-summary-details-title"
    >
      <h3 id="verification-summary-details-title" className="verification-summary-details-title">
        Verification details
      </h3>
      <div className="verification-summary-details-grid">
        <DetailRow
          label="Application"
          value={
            record.applicationNumber?.trim() ? (
              <span className="text-mono">{record.applicationNumber.trim()}</span>
            ) : null
          }
        />
        <DetailRow
          label="Serial"
          value={record.serialNumber?.trim() ? <span className="text-mono">{record.serialNumber}</span> : null}
        />
        <DetailRow label="Type" value={verificationTypeLabel(record.verificationType)} />
        <DetailRow label="VCT" value={verificationVctLabel(record)} />
        <DetailRow label="Belongs to" value={subjectLabel(record)} />
        <DetailRow label="Location" value={locationLabel(record.verificationLocation)} />
        <DetailRow label="Product" value={record.productName} />
        <DetailRow label="Cap / accuracy" value={formatVerificationCapAcc(record)} />
        <DetailRow label="MPE" value={mpe} />
        <DetailRow label="Temperature" value={record.ambientTemperature} />
        <DetailRow label="Humidity" value={record.relativeHumidity} />
        <DetailRow label="Seal ID" value={record.sealIdentificationNumber} />
        {record.verificationType === 'RV' && record.manufacturingYear != null && (
          <DetailRow label="Mfg year" value={String(record.manufacturingYear)} />
        )}
        <DetailRow label="Submitted" value={formatVerificationListDate(record.submittedAt)} />
        <DetailRow label="Certified" value={formatVerificationListDate(record.certifiedAt)} />
        <DetailRow label="Verified on" value={formatVerificationListDate(verifiedOn)} />
      </div>
      {isVoided && <VerificationVoidWatermark variant="details" />}
    </section>
  );
};
