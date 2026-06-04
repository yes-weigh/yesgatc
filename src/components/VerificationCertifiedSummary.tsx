import React from 'react';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import type { SiteCalibration } from '../types';

type VerificationCertifiedSummaryProps = {
  record: SiteCalibration;
  customerPhone?: string | null;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
};

export const VerificationCertifiedSummary: React.FC<VerificationCertifiedSummaryProps> = ({
  record,
  customerPhone,
  onClose,
  closeDisabled = false,
  closeLabel = 'Close',
}) => (
  <div className="verification-certified-summary">
    <div className="verification-certified-summary-head">
      <h2 id="site-calibration-form-title" className="verification-certified-summary-title">
        {record.customerName || 'Verification'}
      </h2>
      {record.certificateNumber?.trim() && (
        <p className="verification-certified-summary-cert text-mono mb-0">
          {record.certificateNumber.trim()}
        </p>
      )}
      <VerificationStatusBadge record={record} />
    </div>
    <VerificationCertifiedActions record={record} customerPhone={customerPhone} />
    <div className="verification-certified-summary-footer">
      <div className="product-form-footer verification-form-footer verification-form-footer--certified-summary">
        <div className="verification-form-footer-row verification-form-footer-row--actions">
          <button
            type="button"
            className="verification-form-btn verification-form-btn--cancel"
            onClick={onClose}
            disabled={closeDisabled}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  </div>
);
