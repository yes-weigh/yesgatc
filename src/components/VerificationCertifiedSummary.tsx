import React from 'react';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationDetailsCard } from './VerificationDetailsCard';
import { VerificationSummaryChrome } from './VerificationSummaryChrome';
import { ListViewBackBar } from './ListViewBackBar';
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
    <ListViewBackBar onBack={onClose} disabled={closeDisabled} />
    <VerificationSummaryChrome record={record} />
    <VerificationCertifiedActions record={record} customerPhone={customerPhone} />
    <VerificationDetailsCard record={record} />
  </div>
);
