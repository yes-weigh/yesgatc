import React from 'react';
import { AlertCircle, FileText } from 'lucide-react';
import { formatRvZohoInvoiceSummary, type RvZohoInvoiceSummary } from '../lib/zohoRvSubmit';

type RvOutstandingZohoInvoiceBannerProps = {
  summary: RvZohoInvoiceSummary;
  applicationNumber?: string;
  /** Super Admin can push legacy RV invoices to Zoho Books. */
  canPush?: boolean;
  rcCenterName?: string;
  onPush?: () => void;
  pushing?: boolean;
  pushBlockedReason?: string | null;
};

export const RvOutstandingZohoInvoiceBanner: React.FC<RvOutstandingZohoInvoiceBannerProps> = ({
  summary,
  applicationNumber,
  canPush = false,
  rcCenterName,
  onPush,
  pushing = false,
  pushBlockedReason,
}) => {
  const centreLabel = rcCenterName?.trim() || 'RC centre';
  const appRef = applicationNumber?.trim();

  return (
    <div
      className={`rv-retroactive-payment-banner mt-3${canPush && !pushBlockedReason ? '' : ' rv-retroactive-payment-banner--readonly'}`}
      role="status"
    >
      <div className="rv-retroactive-payment-banner__text">
        <p className="rv-retroactive-payment-banner__title mb-0">
          <AlertCircle size={16} className="inline-icon" aria-hidden />
          Zoho invoice not sent
        </p>
        <p className="text-muted text-sm mb-0">
          {formatRvZohoInvoiceSummary(summary)} for this RV verification
          {appRef ? ` (${appRef})` : ''}.
          {canPush && !pushBlockedReason
            ? ` Push to Zoho Books for ${centreLabel}.`
            : pushBlockedReason
              ? ` ${pushBlockedReason}`
              : ` Invoice is queued automatically on RV submit; contact Super Admin if it stays unsent.`}
        </p>
      </div>
      {canPush && onPush && !pushBlockedReason && (
        <button
          type="button"
          className="btn btn-primary rv-retroactive-payment-banner__btn"
          onClick={onPush}
          disabled={pushing}
        >
          <FileText size={16} aria-hidden />
          {pushing ? 'Pushing…' : 'Push to Zoho'}
        </button>
      )}
    </div>
  );
};
