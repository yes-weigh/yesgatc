import React from 'react';
import {
  getVerificationDisplayStatus,
  verificationDisplayStatusLabel,
} from '../lib/verificationRequest';
import type { SiteCalibration } from '../types';

interface VerificationStatusBadgeProps {
  record: SiteCalibration;
}

export const VerificationStatusBadge: React.FC<VerificationStatusBadgeProps> = ({ record }) => {
  const displayStatus = getVerificationDisplayStatus(record);
  return (
    <span
      className={`status-badge verification-status verification-status--${displayStatus}`}
      title={verificationDisplayStatusLabel(record)}
    >
      {verificationDisplayStatusLabel(record)}
    </span>
  );
};
