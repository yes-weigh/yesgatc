import React from 'react';
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
import {
  resolveVerificationParty,
  resolveVerificationProduct,
  type VerificationRcPartyProfile,
} from '../lib/verificationPartyDetails';
import { shouldFileCertificateAsRc } from '../lib/keralaRegion';
import type { Customer, Product, SiteCalibration } from '../types';

export type VerificationDetailSpecsProps = {
  record: SiteCalibration;
  customer?: Customer | null;
  product?: Product | null;
  rcProfile?: VerificationRcPartyProfile | null;
  /** Hide fields already shown in the summary chrome (app, cert, zoho, serial, customer). */
  omitChromeFields?: boolean;
  /** RC contact person fallback when performedBy is rc and record has no stamped name. */
  rcContactPerson?: string | null;
  className?: string;
};

function displayText(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const text = String(value).trim();
  return text || '—';
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

function Field({
  label,
  value,
  full = false,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={`vd-field${full ? ' vd-field--full' : ''}`}>
      <span className="vd-field__label">{label}</span>
      <span className={`vd-field__value${mono ? ' vd-field__value--mono' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

export const VerificationDetailSpecs: React.FC<VerificationDetailSpecsProps> = ({
  record,
  customer = null,
  product = null,
  rcProfile = null,
  omitChromeFields: _omitChromeFields = false,
  rcContactPerson = null,
  className = '',
}) => {
  const party = resolveVerificationParty(record, { customer, rc: rcProfile });
  const productInfo = resolveVerificationProduct(record, product);
  const subject = inferVerificationSubject(record);
  const climate = `${formatTemperature(record.ambientTemperature)} · ${formatHumidity(record.relativeHumidity)}`;
  const filesUnderRc =
    Boolean(record.fileCertificateAsRc)
    || shouldFileCertificateAsRc({
      verificationSubject: subject,
      pincode: party.pincode,
    });

  return (
    <div className={`vd-sheet${className ? ` ${className}` : ''}`}>
      <section className="vd-block" aria-label="Customer">
        <h3 className="vd-block__title">
          {filesUnderRc || subject === 'self' ? 'RC centre' : 'Customer'}
        </h3>
        {filesUnderRc ? (
          <p className="vd-kerala-note" role="status">
            Certificate files under RC centre — customer PIN is outside Kerala.
          </p>
        ) : null}
        <div className="vd-fields">
          <Field label="Name" value={displayText(party.name)} />
          <Field label="Phone" value={displayText(party.phone)} />
          <Field label="Address" value={displayText(party.address)} full />
          <Field label="Pincode" value={displayText(party.pincode)} mono />
          <Field label="District" value={displayText(party.district)} />
          <Field label="State" value={displayText(party.state)} />
          {record.sourceCustomerName?.trim() ? (
            <Field label="Original customer" value={displayText(record.sourceCustomerName)} full />
          ) : null}
        </div>
      </section>

      <section className="vd-block" aria-label="Instrument">
        <h3 className="vd-block__title">Instrument</h3>
        <div className="vd-fields">
          <Field label="Type" value={verificationTypeLabel(record.verificationType)} />
          <Field label="Location" value={verificationLocationLabel(record.verificationLocation)} />
          <Field label="Product" value={displayText(productInfo.name)} full />
          <Field label="Manufacturer" value={displayText(productInfo.manufacturer)} />
          <Field label="Model approval" value={displayText(productInfo.modelApprovalNo)} mono />
          <Field label="Cap / e" value={formatVerificationCapAcc(record, product)} />
          <Field
            label="Class / MPE"
            value={`${displayText(productInfo.accuracyClass || 'III')} / ${formatProductMpe(record.maximumPermissibleError)}`}
          />
          {record.verificationType === 'RV' && record.manufacturingYear != null ? (
            <Field label="Mfg year" value={String(record.manufacturingYear)} />
          ) : null}
          <Field label="VCT" value={verificationVctLabel(record, { rcContactPerson })} full />
          <Field label="Seal ID" value={displayText(record.sealIdentificationNumber)} mono full />
          <Field label="Climate" value={climate} />
        </div>
      </section>
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
