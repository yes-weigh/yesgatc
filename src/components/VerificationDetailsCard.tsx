import React, { useMemo, useState } from 'react';
import {
  Award,
  Barcode,
  Calendar,
  Crosshair,
  Droplets,
  FileText,
  MapPin,
  Package,
  Scale,
  Shield,
  ShieldCheck,
  Thermometer,
  Users,
  ZoomIn,
} from 'lucide-react';
import { StorageImage } from './StorageImage';
import { ProductSpecIconTile } from './ProductSpecIconTile';
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

function locationLabel(value?: SiteCalibration['verificationLocation']): string | null {
  if (!value) return null;
  return VERIFICATION_LOCATION_OPTIONS.find(opt => opt.value === value)?.label ?? value;
}

function subjectLabel(record: SiteCalibration): string | null {
  if (record.verificationSubject === 'self') return 'Self';
  if (record.verificationSubject === 'customer') return 'Customer';
  return null;
}

function formatTemperature(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.includes('°') ? trimmed : `${trimmed} °C`;
}

function formatHumidity(value?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.includes('%') ? trimmed : `${trimmed} %`;
}

export const VerificationDetailsCard: React.FC<VerificationDetailsCardProps> = ({
  record,
  className = '',
}) => {
  const mpe =
    record.maximumPermissibleError != null ? `${record.maximumPermissibleError} g` : null;
  const isVoided = isVerificationCertificateVoided(record);
  const attachments = useMemo(() => listVerificationAttachmentsFromRecord(record), [record]);
  const [viewerAttachmentId, setViewerAttachmentId] = useState<string | null>(null);
  const viewerIndex =
    viewerAttachmentId !== null
      ? attachments.findIndex(item => item.id === viewerAttachmentId)
      : -1;

  const detailTiles: Array<{
    key: string;
    label: string;
    value: React.ReactNode;
    icon: typeof FileText;
    tone: 'sky' | 'violet' | 'teal' | 'emerald' | 'orange' | 'pink' | 'blue';
    mono?: boolean;
  }> = [];

  const pushTile = (
    key: string,
    label: string,
    value: React.ReactNode,
    icon: typeof FileText,
    tone: 'sky' | 'violet' | 'teal' | 'emerald' | 'orange' | 'pink' | 'blue',
    mono = false,
  ) => {
    if (value === null || value === undefined || value === '' || value === '—') return;
    detailTiles.push({ key, label, value, icon, tone, mono });
  };

  pushTile(
    'application',
    'Application',
    record.applicationNumber?.trim() || null,
    FileText,
    'sky',
    true,
  );
  pushTile('serial', 'Serial', record.serialNumber?.trim() || null, Barcode, 'sky', true);
  pushTile('type', 'Type', verificationTypeLabel(record.verificationType), Package, 'violet');
  pushTile('vct', 'VCT', verificationVctLabel(record), ShieldCheck, 'violet');
  pushTile('belongs', 'Belongs to', subjectLabel(record), Users, 'teal');
  pushTile('location', 'Location', locationLabel(record.verificationLocation), MapPin, 'emerald');
  pushTile('product', 'Product', record.productName, Package, 'orange');
  pushTile('cap', 'Cap / accuracy', formatVerificationCapAcc(record), Crosshair, 'orange');
  pushTile('mpe', 'MPE', mpe, Scale, 'pink');
  pushTile('temperature', 'Temperature', formatTemperature(record.ambientTemperature), Thermometer, 'pink');
  pushTile('humidity', 'Humidity', formatHumidity(record.relativeHumidity), Droplets, 'blue');
  pushTile('seal', 'Seal ID', record.sealIdentificationNumber, Shield, 'blue', true);
  if (record.verificationType === 'RV' && record.manufacturingYear != null) {
    pushTile('mfg', 'Mfg year', String(record.manufacturingYear), Calendar, 'violet');
  }
  pushTile('submitted', 'Submitted', formatVerificationListDate(record.submittedAt), Calendar, 'emerald');
  pushTile('certified', 'Certified on', formatVerificationListDate(record.certifiedAt), Award, 'emerald');

  return (
    <section
      className={`verification-summary-details-card verification-ref-details-card${
        isVoided ? ' verification-summary-details-card--voided' : ''
      }${className ? ` ${className}` : ''}`}
      aria-label="Verification details"
    >
      <div className="details-specs-icon-grid verification-ref-details-grid">
        {detailTiles.map(tile => (
          <ProductSpecIconTile
            key={tile.key}
            label={tile.label}
            value={tile.value}
            icon={tile.icon}
            tone={tile.tone}
            mono={tile.mono}
          />
        ))}
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
