import React from 'react';
import {
  formatRcFeeAmount,
  verificationFeeWithGst,
  VERIFICATION_FEE_GST_RATE,
} from '../lib/rcProfileFields';

const GST_PERCENT_LABEL = `${Math.round(VERIFICATION_FEE_GST_RATE * 100)}%`;

export type VerificationFeeBreakdownVariant = 'cell' | 'inline' | 'summary-rows' | 'total-footer';

type VerificationFeeBreakdownProps = {
  baseAmount: number;
  variant?: VerificationFeeBreakdownVariant;
  className?: string;
};

export const VerificationFeeBreakdown: React.FC<VerificationFeeBreakdownProps> = ({
  baseAmount,
  variant = 'cell',
  className = '',
}) => {
  const { base, gst, total } = verificationFeeWithGst(baseAmount);
  const rootClass = ['verification-fee-breakdown', `verification-fee-breakdown--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  if (variant === 'inline') {
    return (
      <span className={rootClass}>
        <span className="verification-fee-breakdown-base">{formatRcFeeAmount(base)}</span>
        <span className="verification-fee-breakdown-plus" aria-hidden>
          +
        </span>
        <span className="verification-fee-breakdown-gst">
          {formatRcFeeAmount(gst)} <span className="verification-fee-breakdown-gst-label">GST</span>
        </span>
        <span className="verification-fee-breakdown-eq" aria-hidden>
          =
        </span>
        <strong className="verification-fee-breakdown-total">{formatRcFeeAmount(total)}</strong>
      </span>
    );
  }

  if (variant === 'summary-rows') {
    return (
      <div className={rootClass}>
        <div className="verification-fee-breakdown-row">
          <span>Base</span>
          <span>{formatRcFeeAmount(base)}</span>
        </div>
        <div className="verification-fee-breakdown-row">
          <span>GST ({GST_PERCENT_LABEL})</span>
          <span>{formatRcFeeAmount(gst)}</span>
        </div>
        <div className="verification-fee-breakdown-row verification-fee-breakdown-row--total">
          <span>Total</span>
          <strong>{formatRcFeeAmount(total)}</strong>
        </div>
      </div>
    );
  }

  if (variant === 'total-footer') {
    return (
      <div className={rootClass}>
        <div className="verification-fees-total-line">
          <span>Subtotal</span>
          <span>{formatRcFeeAmount(base)}</span>
        </div>
        <div className="verification-fees-total-line">
          <span>GST ({GST_PERCENT_LABEL})</span>
          <span>{formatRcFeeAmount(gst)}</span>
        </div>
        <div className="verification-fees-total-line verification-fees-total-line--grand">
          <span>Total</span>
          <strong>{formatRcFeeAmount(total)}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <div className="verification-fee-breakdown-line">
        <span className="verification-fee-breakdown-line-label">Base</span>
        <span>{formatRcFeeAmount(base)}</span>
      </div>
      <div className="verification-fee-breakdown-line">
        <span className="verification-fee-breakdown-line-label">GST ({GST_PERCENT_LABEL})</span>
        <span>{formatRcFeeAmount(gst)}</span>
      </div>
      <div className="verification-fee-breakdown-line verification-fee-breakdown-line--total">
        <span className="verification-fee-breakdown-line-label">Total</span>
        <strong className="verification-device-fee">{formatRcFeeAmount(total)}</strong>
      </div>
    </div>
  );
};
