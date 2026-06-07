import React, { useMemo, useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { StorageImage } from './StorageImage';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { listVerificationAttachmentsFromRecord } from '../lib/verificationAttachments';
import { VerificationPhotoViewer } from './VerificationPhotoViewer';
import { VerificationVoidWatermark } from './VerificationVoidWatermark';
import { VerificationDetailSpecs } from './VerificationDetailSpecs';
import type { SiteCalibration } from '../types';

type VerificationDetailsCardProps = {
  record: SiteCalibration;
  className?: string;
};

export const VerificationDetailsCard: React.FC<VerificationDetailsCardProps> = ({
  record,
  className = '',
}) => {
  const isVoided = isVerificationCertificateVoided(record);
  const attachments = useMemo(() => listVerificationAttachmentsFromRecord(record), [record]);
  const [viewerAttachmentId, setViewerAttachmentId] = useState<string | null>(null);
  const viewerIndex =
    viewerAttachmentId !== null
      ? attachments.findIndex(item => item.id === viewerAttachmentId)
      : -1;

  return (
    <section
      className={`verification-summary-details-card verification-ref-details-card${
        isVoided ? ' verification-summary-details-card--voided' : ''
      }${className ? ` ${className}` : ''}`}
      aria-label="Verification details"
    >
      <VerificationDetailSpecs record={record} omitChromeFields includeTimeline />

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

      {viewerIndex >= 0 && (
        <VerificationPhotoViewer
          open
          images={attachments.map(item => ({
            id: item.id,
            label: item.label,
            url: item.url,
            path: item.path,
          }))}
          initialIndex={viewerIndex}
          onClose={() => setViewerAttachmentId(null)}
        />
      )}

      {isVoided && <VerificationVoidWatermark variant="details" />}
    </section>
  );
};
