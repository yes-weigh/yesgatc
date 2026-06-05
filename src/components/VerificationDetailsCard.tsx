import React, { useMemo, useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { StorageImage } from './StorageImage';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { listVerificationAttachmentsFromRecord } from '../lib/verificationAttachments';
import { VerificationPhotoViewer } from './VerificationPhotoViewer';
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
  const attachments = useMemo(() => listVerificationAttachmentsFromRecord(record), [record]);
  const [viewerAttachmentId, setViewerAttachmentId] = useState<string | null>(null);
  const viewerAttachment = attachments.find(item => item.id === viewerAttachmentId) ?? null;

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

      {attachments.length > 0 && (
        <div className="verification-summary-photos">
          <div className="verification-summary-photos-head">
            <span className="verification-summary-photos-title">Evidence photos</span>
            <span className="verification-summary-photos-count">{attachments.length}</span>
          </div>
          <div className="verification-summary-photos-strip" role="group" aria-label="Attached photos">
            {attachments.map(item => (
              <button
                key={item.id}
                type="button"
                className={`verification-summary-photo-tile verification-summary-photo-tile--${item.id}`}
                onClick={() => setViewerAttachmentId(item.id)}
                aria-label={`View ${item.label}`}
              >
                <span className="verification-summary-photo-tile-frame">
                  <StorageImage
                    url={item.url}
                    path={item.path}
                    alt=""
                    className="verification-summary-photo-tile-img"
                  />
                  <span className="verification-summary-photo-tile-overlay" aria-hidden />
                  <span className="verification-summary-photo-tile-zoom" aria-hidden>
                    <ZoomIn size={16} strokeWidth={2.25} />
                  </span>
                </span>
                <span className="verification-summary-photo-tile-label">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {viewerAttachment && (
        <VerificationPhotoViewer
          open
          label={viewerAttachment.label}
          imageUrl={viewerAttachment.url}
          storagePath={viewerAttachment.path}
          onClose={() => setViewerAttachmentId(null)}
        />
      )}

      {isVoided && <VerificationVoidWatermark variant="details" />}
    </section>
  );
};
