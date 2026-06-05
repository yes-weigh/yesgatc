import React from 'react';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationDetailsCard } from './VerificationDetailsCard';
import { VerificationSummaryChrome } from './VerificationSummaryChrome';
import { ListViewBackBar } from './ListViewBackBar';
import type { SiteCalibration } from '../types';

type VerificationCertifiedSummaryProps = {
  record: SiteCalibration;
  onClose: () => void;
  closeDisabled?: boolean;
};

export const VerificationCertifiedSummary: React.FC<VerificationCertifiedSummaryProps> = ({
  record,
  onClose,
  closeDisabled = false,
}) => (
  <div className="verification-certified-summary">
    <ListViewBackBar onBack={onClose} disabled={closeDisabled} />
    <VerificationSummaryChrome record={record} />
    <VerificationCertifiedActions record={record} />
    <VerificationDetailsCard record={record} />
  </div>
);
