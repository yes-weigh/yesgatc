import React from 'react';
import {
  hasEmaapSignedPdfUpload,
  signedCertificateAvailability,
  signedCertificateAvailabilityLabel,
} from '../lib/signedCertificatePdf';
import type { SiteCalibration } from '../types';

type SignedCertificateAvailabilityBadgeProps = {
  record: SiteCalibration;
  className?: string;
};

export const SignedCertificateAvailabilityBadge: React.FC<
  SignedCertificateAvailabilityBadgeProps
> = ({ record, className = '' }) => {
  const availability = signedCertificateAvailability(record);
  if (!availability || availability === 'voided') return null;

  const onEmaap = availability === 'available' && hasEmaapSignedPdfUpload(record);
  const label = signedCertificateAvailabilityLabel(availability, onEmaap);

  return (
    <span
      className={`signed-cert-avail signed-cert-avail--${availability}${
        onEmaap ? ' signed-cert-avail--emaap' : ''
      }${className ? ` ${className}` : ''}`}
      title={
        availability === 'available'
          ? onEmaap
            ? 'DSC-signed PDF is in Firebase and uploaded to eMAAP.'
            : 'DSC-signed PDF is in Firebase. Waiting for eMAAP Certificates Issued upload.'
          : availability === 'missing'
            ? 'No DSC-signed PDF in Firebase yet.'
            : 'Sequence 2304 or earlier — no separate signed PDF required.'
      }
    >
      {label}
    </span>
  );
};
