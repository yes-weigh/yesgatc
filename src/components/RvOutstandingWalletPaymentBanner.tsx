import React from 'react';
import { AlertCircle, Wallet } from 'lucide-react';
import { formatRcFeeAmount } from '../lib/rcProfileFields';
import type { RvPaymentBreakdown } from '../lib/rvPaymentAmount';

type RvOutstandingWalletPaymentBannerProps = {
  breakdown: RvPaymentBreakdown;
  /** Super Admin can pay legacy RV fees from the RC wallet. */
  canPay?: boolean;
  rcCenterName?: string;
  onPay?: () => void;
  paying?: boolean;
};

export const RvOutstandingWalletPaymentBanner: React.FC<RvOutstandingWalletPaymentBannerProps> = ({
  breakdown,
  canPay = false,
  rcCenterName,
  onPay,
  paying = false,
}) => {
  const centreLabel = rcCenterName?.trim() || 'RC centre';

  return (
    <div
      className={`rv-retroactive-payment-banner mt-3${canPay ? '' : ' rv-retroactive-payment-banner--readonly'}`}
      role="status"
    >
      <div className="rv-retroactive-payment-banner__text">
        <p className="rv-retroactive-payment-banner__title mb-0">
          <AlertCircle size={16} className="inline-icon" aria-hidden />
          Administrative fees not paid
        </p>
        <p className="text-muted text-sm mb-0">
          {formatRcFeeAmount(breakdown.total)} due for this RV verification
          {canPay
            ? `. Pay from ${centreLabel}'s wallet balance.`
            : `. Super Admin will pay from ${centreLabel}'s wallet — top up the wallet if balance is insufficient.`}
        </p>
      </div>
      {canPay && onPay && (
        <button
          type="button"
          className="btn btn-primary rv-retroactive-payment-banner__btn"
          onClick={onPay}
          disabled={paying}
        >
          <Wallet size={16} aria-hidden />
          {paying ? 'Processing…' : 'Pay from RC wallet'}
        </button>
      )}
    </div>
  );
};
