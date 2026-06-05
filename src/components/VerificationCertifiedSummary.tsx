import React from 'react';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationDetailsCard } from './VerificationDetailsCard';
import { VerificationSummaryChrome } from './VerificationSummaryChrome';
import { VerificationViewBackBar } from './VerificationViewBackBar';
import type { SiteCalibration } from '../types';

type VerificationCertifiedSummaryProps = {
  record: SiteCalibration;
  customerPhone?: string | null;
  onClose: () => void;
  closeDisabled?: boolean;
};

export const VerificationCertifiedSummary: React.FC<VerificationCertifiedSummaryProps> = ({
  record,
  customerPhone,
  onClose,
  closeDisabled = false,
}) => (
  <div className="verification-certified-summary">
    <VerificationViewBackBar onBack={onClose} disabled={closeDisabled} />
    <VerificationSummaryChrome record={record} />
    <VerificationCertifiedActions record={record} customerPhone={customerPhone} />
    <VerificationDetailsCard record={record} />
  </div>
);
