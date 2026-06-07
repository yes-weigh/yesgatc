import React from 'react';
import {
  Award,
  Barcode,
  Calendar,
  CalendarCheck,
  ClipboardCheck,
  Droplets,
  MapPin,
  Package,
  Shield,
  Target,
  Thermometer,
  Users,
} from 'lucide-react';
import { formatProductMpe } from '../lib/productCalculations';
import {
  inferVerificationSubject,
  verificationLocationLabel,
  verificationTypeLabel,
} from '../lib/siteCalibrationProfileFields';
import {
  formatVerificationCapAcc,
  verificationVctLabel,
} from '../lib/verificationRequest';
import { ProductSpecIconTile } from './ProductSpecIconTile';
import type { SiteCalibration } from '../types';

export type VerificationDetailSpecsProps = {
  record: SiteCalibration;
  /** Hide fields already shown in the summary chrome (app, cert, zoho, serial, customer). */
  omitChromeFields?: boolean;
  /** Wide submitted / certified tiles below the grid. */
  includeTimeline?: boolean;
  className?: string;
};

function displayText(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const text = String(value).trim();
  return text || '—';
}

function formatSummaryDate(iso?: string): string {
  if (!iso?.trim()) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatTemperature(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return '—';
  return trimmed.endsWith('°') ? trimmed : `${trimmed} °C`;
}

function formatHumidity(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return '—';
  return trimmed.endsWith('%') ? trimmed : `${trimmed} %`;
}

function verificationSubjectLabel(record: SiteCalibration): string {
  return inferVerificationSubject(record) === 'self' ? 'Self' : 'Customer';
}

export const VerificationDetailSpecs: React.FC<VerificationDetailSpecsProps> = ({
  record,
  omitChromeFields = false,
  includeTimeline = false,
  className = '',
}) => {
  const tiles: React.ReactNode[] = [];

  if (!omitChromeFields) {
    const app = record.applicationNumber?.trim();
    const serial = record.serialNumber?.trim();
    if (app) {
      tiles.push(
        <ProductSpecIconTile
          key="application"
          label="Application"
          value={app}
          icon={Award}
          tone="sky"
          mono
        />,
      );
    }
    if (serial) {
      tiles.push(
        <ProductSpecIconTile
          key="serial"
          label="Serial"
          value={serial}
          icon={Barcode}
          tone="blue"
          mono
        />,
      );
    }
  }

  tiles.push(
    <ProductSpecIconTile
      key="type"
      label="Type"
      value={verificationTypeLabel(record.verificationType)}
      icon={ClipboardCheck}
      tone="violet"
    />,
    <ProductSpecIconTile
      key="vct"
      label="VCT"
      value={verificationVctLabel(record)}
      icon={Shield}
      tone="violet"
    />,
    <ProductSpecIconTile
      key="belongs"
      label="Belongs to"
      value={verificationSubjectLabel(record)}
      icon={Users}
      tone="emerald"
    />,
    <ProductSpecIconTile
      key="location"
      label="Location"
      value={verificationLocationLabel(record.verificationLocation)}
      icon={MapPin}
      tone="emerald"
    />,
    <ProductSpecIconTile
      key="product"
      label="Product"
      value={displayText(record.productName)}
      icon={Package}
      tone="orange"
    />,
    <ProductSpecIconTile
      key="cap-acc"
      label="Cap / accuracy"
      value={formatVerificationCapAcc(record)}
      icon={Target}
      tone="orange"
    />,
    <ProductSpecIconTile
      key="mpe"
      label="MPE"
      value={formatProductMpe(record.maximumPermissibleError)}
      icon={Target}
      tone="rose"
    />,
    <ProductSpecIconTile
      key="temperature"
      label="Temperature"
      value={formatTemperature(record.ambientTemperature)}
      icon={Thermometer}
      tone="rose"
    />,
    <ProductSpecIconTile
      key="humidity"
      label="Humidity"
      value={formatHumidity(record.relativeHumidity)}
      icon={Droplets}
      tone="cyan"
    />,
    <ProductSpecIconTile
      key="seal"
      label="Seal ID"
      value={displayText(record.sealIdentificationNumber)}
      icon={Shield}
      tone="indigo"
      mono
    />,
  );

  if (record.verificationType === 'RV' && record.manufacturingYear != null) {
    tiles.push(
      <ProductSpecIconTile
        key="mfg-year"
        label="Mfg year"
        value={String(record.manufacturingYear)}
        icon={Calendar}
        tone="lime"
      />,
    );
  }

  return (
    <div className={`verification-ref-details-stack${className ? ` ${className}` : ''}`}>
      <div className="details-specs-icon-grid verification-ref-details-grid">
        {tiles}
      </div>

      {includeTimeline && (
        <div className="verification-ref-timeline" aria-label="Submission and certification dates">
          <div className="verification-ref-timeline-tile verification-ref-timeline-tile--submitted">
            <span className="verification-ref-timeline-icon" aria-hidden>
              <Calendar size={18} strokeWidth={2} />
            </span>
            <div className="verification-ref-timeline-body">
              <span className="verification-ref-timeline-label">Submitted on</span>
              <span className="verification-ref-timeline-value">
                {formatSummaryDate(record.submittedAt)}
              </span>
            </div>
          </div>
          <div className="verification-ref-timeline-tile verification-ref-timeline-tile--certified">
            <span className="verification-ref-timeline-icon" aria-hidden>
              <CalendarCheck size={18} strokeWidth={2} />
            </span>
            <div className="verification-ref-timeline-body">
              <span className="verification-ref-timeline-label">Certified on</span>
              <span className="verification-ref-timeline-value">
                {formatSummaryDate(record.certifiedAt || record.approvedAt)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const VerificationDetailSpecSection: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <section className="verification-detail-section">
    <h3 className="verification-detail-section-title">{title}</h3>
    {children}
  </section>
);

export const VerificationDetailSpecRow: React.FC<{
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  full?: boolean;
}> = ({ label, value, mono = false, full = false }) => (
  <div className={`verification-detail-row${full ? ' verification-detail-row--full' : ''}`}>
    <span className="verification-detail-label">{label}</span>
    <span className={`verification-detail-value${mono ? ' text-mono' : ''}`}>
      {value ?? '—'}
    </span>
  </div>
);
