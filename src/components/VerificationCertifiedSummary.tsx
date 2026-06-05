import React from 'react';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationDetailsCard } from './VerificationDetailsCard';
import { VerificationSummaryChrome } from './VerificationSummaryChrome';
import type { SiteCalibration } from '../types';

type VerificationCertifiedSummaryProps = {
  record: SiteCalibration;
  customerPhone?: string | null;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  showHeaderClose?: boolean;
};

export const VerificationCertifiedSummary: React.FC<VerificationCertifiedSummaryProps> = ({
  record,
  customerPhone,
  onClose,
  closeDisabled = false,
  showHeaderClose = false,
}) => (
  <div className="verification-certified-summary">
    <VerificationSummaryChrome
      record={record}
      onClose={onClose}
      closeDisabled={closeDisabled}
      showClose={showHeaderClose}
    />
    <VerificationCertifiedActions record={record} customerPhone={customerPhone} />
    <VerificationDetailsCard record={record} />
    {!showHeaderClose && (
      <div className="verification-certified-summary-footer">
        <div className="product-form-footer verification-form-footer verification-form-footer--certified-summary">
          <div className="verification-form-footer-row verification-form-footer-row--actions">
            <button
              type="button"
              className="verification-form-btn verification-form-btn--cancel"
              onClick={onClose}
              disabled={closeDisabled}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);
