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

  const signedLook = availability === 'available' || availability === 'legacy';

  return (
    <span
      className={`signed-cert-avail signed-cert-avail--${availability}${
        signedLook ? ' signed-cert-avail--emaap' : ''
      }${className ? ` ${className}` : ''}`}
      title={
        availability === 'available'
          ? 'DSC-signed PDF is uploaded on eMAAP Certificates Issued.'
          : availability === 'missing'
            ? 'Signed PDF is not on eMAAP yet. File may still be in Firebase.'
            : 'Certificate is signed.'
      }
    >
      {label}
    </span>
  );
};
