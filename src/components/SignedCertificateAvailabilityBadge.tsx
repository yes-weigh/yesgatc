import React from 'react';
import {
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

  const label = signedCertificateAvailabilityLabel(availability);

  return (
    <span
      className={`signed-cert-avail signed-cert-avail--${availability}${
        availability === 'available' ? ' signed-cert-avail--emaap' : ''
      }${className ? ` ${className}` : ''}`}
      title={
        availability === 'available'
          ? 'DSC-signed PDF is uploaded on eMAAP Certificates Issued.'
          : availability === 'missing'
            ? 'Signed PDF is not on eMAAP yet. File may still be in Firebase.'
            : 'Sequence 2304 or earlier — no separate signed PDF required.'
      }
    >
      {label}
    </span>
  );
};
