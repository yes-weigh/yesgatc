import React from 'react';
import { AlertCircle } from 'lucide-react';
import {
  formatRvZohoInvoiceSummary,
  rvZohoInvoiceSummary,
  type RvZohoInvoiceSummary,
} from '../lib/zohoRvSubmit';
import type { SiteCalibration } from '../types';

type RvZohoSubmitGateBannerProps = {
  record: Pick<SiteCalibration, 'maximumCapacity' | 'unitOfMeasurement' | 'applicationNumber' | 'zohoPushError'>;
  summary?: RvZohoInvoiceSummary | null;
};

export const RvZohoSubmitGateBanner: React.FC<RvZohoSubmitGateBannerProps> = ({
  record,
  summary: summaryProp,
}) => {
  const summary = summaryProp ?? rvZohoInvoiceSummary(record);
  const appRef = record.applicationNumber?.trim();
  const zohoError = record.zohoPushError?.trim();

  return (
    <div className="rv-retroactive-payment-banner rv-retroactive-payment-banner--readonly mt-3" role="status">
      <div className="rv-retroactive-payment-banner__text">
        <p className="rv-retroactive-payment-banner__title mb-0">
          <AlertCircle size={16} className="inline-icon" aria-hidden />
          Zoho invoice failed — not submitted
        </p>
        <p className="text-muted text-sm mb-0">
          {summary
            ? `${formatRvZohoInvoiceSummary(summary)} for this RV verification`
            : 'This RV verification'}
          {appRef ? ` (${appRef})` : ''} could not be invoiced in Zoho Books.
          {zohoError ? ` ${zohoError}` : ' Try again with Retry Zoho & submit.'}
          {' '}Your wallet payment is kept.
        </p>
      </div>
    </div>
  );
};
