import React from 'react';
import {
  formatRcFeeAmount,
  verificationFeeWithGst,
  VERIFICATION_FEE_GST_RATE,
} from '../lib/rcProfileFields';
import { parseAdditionalFeeInput, parseServiceFeeInput } from '../lib/verificationDocaCharges';

const GST_PERCENT_LABEL = `${Math.round(VERIFICATION_FEE_GST_RATE * 100)}%`;

export type VerificationFeeBreakdownVariant = 'cell' | 'inline' | 'summary-rows' | 'total-footer';

export type VerificationEditableFeeProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  inputId?: string;
  ariaLabel: string;
};

type VerificationFeeBreakdownProps = {
  /** Quoted RC verification fee (₹150 / ₹250). TDS and gateway are shown as a breakdown within this amount. */
  baseAmount: number;
  variant?: VerificationFeeBreakdownVariant;
  className?: string;
  tdsAmount?: number;
  gatewayFeeAmount?: number;
  serviceFee?: VerificationEditableFeeProps;
  additionalFee?: VerificationEditableFeeProps;
  tdsTotal?: number;
  gatewayFeeTotal?: number;
  serviceFeeTotal?: number;
  additionalFeeTotal?: number;
};

function editableFeeAmount(fee?: VerificationEditableFeeProps, parse = parseServiceFeeInput): number {
  if (!fee) return 0;
  return parse(fee.value);
}

function EditableFeeValue({ fee }: { fee: VerificationEditableFeeProps }) {
  if (fee.onChange && !fee.readOnly) {
    return (
      <span className="verification-fee-breakdown-editable-field">
        <span className="verification-fee-breakdown-editable-prefix" aria-hidden>
          ₹
        </span>
        <input
          id={fee.inputId}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className="verification-fee-breakdown-editable-input"
          value={fee.value}
          onChange={e => fee.onChange!(e.target.value)}
          onClick={e => e.stopPropagation()}
          aria-label={fee.ariaLabel}
        />
      </span>
    );
  }

  return <span>{formatRcFeeAmount(parseServiceFeeInput(fee.value))}</span>;
}

function extraFeesTotal(
  serviceFee?: VerificationEditableFeeProps,
  additionalFee?: VerificationEditableFeeProps,
): number {
  return (
    editableFeeAmount(serviceFee, parseServiceFeeInput)
    + editableFeeAmount(additionalFee, parseAdditionalFeeInput)
  );
}

function QuotedBaseLines({
  quotedBase,
  tds,
  gateway,
  lineClassName,
  grouped = false,
}: {
  quotedBase: number;
  tds: number;
  gateway: number;
  lineClassName: string;
  grouped?: boolean;
}) {
  const lines = (
    <>
      <div className={`${lineClassName} verification-fees-total-line--primary`}>
        <span>Verification fee</span>
        <span>{formatRcFeeAmount(quotedBase)}</span>
      </div>
      <div className="verification-fees-fee-chip" aria-label="Administrative fees">
        <p className="verification-fees-fee-chip-title">Administrative fees</p>
        <div className="verification-fees-fee-chip-row">
          <span>TDS</span>
          <span>{formatRcFeeAmount(tds)}</span>
        </div>
        {gateway > 0 && (
          <div className="verification-fees-fee-chip-row">
            <span>Gateway</span>
            <span>{formatRcFeeAmount(gateway)}</span>
          </div>
        )}
      </div>
    </>
  );

  if (!grouped) return lines;

  return <div className="verification-fees-total-group">{lines}</div>;
}

export const VerificationFeeBreakdown: React.FC<VerificationFeeBreakdownProps> = ({
  baseAmount,
  variant = 'cell',
  className = '',
  tdsAmount = 0,
  gatewayFeeAmount = 0,
  serviceFee,
  additionalFee,
  tdsTotal = 0,
  gatewayFeeTotal = 0,
  serviceFeeTotal = 0,
  additionalFeeTotal = 0,
}) => {
  const { gst } = verificationFeeWithGst(baseAmount);
  const lineExtras = extraFeesTotal(serviceFee, additionalFee);
  const lineGrandTotal = baseAmount + gst + lineExtras;
  const rootClass = ['verification-fee-breakdown', `verification-fee-breakdown--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  if (variant === 'inline') {
    return (
      <span className={rootClass}>
        <span className="verification-fee-breakdown-base">{formatRcFeeAmount(baseAmount)}</span>
        <span className="verification-fee-breakdown-plus" aria-hidden>
          +
        </span>
        <span className="verification-fee-breakdown-gst">
          {formatRcFeeAmount(gst)} <span className="verification-fee-breakdown-gst-label">GST</span>
        </span>
        {(serviceFee || additionalFee) && (
          <>
            <span className="verification-fee-breakdown-plus" aria-hidden>
              +
            </span>
            <span className="verification-fee-breakdown-extra">
              {formatRcFeeAmount(lineExtras)}
            </span>
          </>
        )}
        <span className="verification-fee-breakdown-eq" aria-hidden>
          =
        </span>
        <strong className="verification-fee-breakdown-total">{formatRcFeeAmount(lineGrandTotal)}</strong>
      </span>
    );
  }

  if (variant === 'summary-rows') {
    return (
      <div className={rootClass}>
        <QuotedBaseLines
          quotedBase={baseAmount}
          tds={tdsAmount}
          gateway={gatewayFeeAmount}
          lineClassName="verification-fee-breakdown-row"
        />
        <div className="verification-fee-breakdown-row">
          <span>GST ({GST_PERCENT_LABEL})</span>
          <span>{formatRcFeeAmount(gst)}</span>
        </div>
        {serviceFee && (
          <div className="verification-fee-breakdown-row">
            <span>Service fee</span>
            <EditableFeeValue fee={serviceFee} />
          </div>
        )}
        {additionalFee && (
          <div className="verification-fee-breakdown-row">
            <span>Additional fee</span>
            <EditableFeeValue fee={additionalFee} />
          </div>
        )}
        <div className="verification-fee-breakdown-row verification-fee-breakdown-row--total">
          <span>Total</span>
          <strong>{formatRcFeeAmount(lineGrandTotal)}</strong>
        </div>
      </div>
    );
  }

  if (variant === 'total-footer') {
    const grandTotal = baseAmount + gst + serviceFeeTotal + additionalFeeTotal;
    return (
      <div className={rootClass}>
        <QuotedBaseLines
          quotedBase={baseAmount}
          tds={tdsTotal}
          gateway={gatewayFeeTotal}
          lineClassName="verification-fees-total-line"
          grouped
        />
        <div className="verification-fees-total-line verification-fees-total-line--section">
          <span>GST ({GST_PERCENT_LABEL})</span>
          <span>{formatRcFeeAmount(gst)}</span>
        </div>
        {serviceFeeTotal > 0 && (
          <div className="verification-fees-total-line">
            <span>Service fee</span>
            <span>{formatRcFeeAmount(serviceFeeTotal)}</span>
          </div>
        )}
        {additionalFeeTotal > 0 && (
          <div className="verification-fees-total-line">
            <span>Additional fee</span>
            <span>{formatRcFeeAmount(additionalFeeTotal)}</span>
          </div>
        )}
        <div className="verification-fees-total-line verification-fees-total-line--grand">
          <span>Total</span>
          <strong>{formatRcFeeAmount(grandTotal)}</strong>
        </div>
      </div>
    );
  }

  const additionalFeeAmount = editableFeeAmount(additionalFee, parseAdditionalFeeInput);

  return (
    <div className={rootClass}>
      <QuotedBaseLines
        quotedBase={baseAmount}
        tds={tdsAmount}
        gateway={gatewayFeeAmount}
        lineClassName="verification-fees-total-line"
        grouped
      />
      <div className="verification-fees-total-line verification-fees-total-line--section">
        <span>GST ({GST_PERCENT_LABEL})</span>
        <span>{formatRcFeeAmount(gst)}</span>
      </div>
      {serviceFee && (
        <div className="verification-fees-total-line verification-fees-total-line--editable">
          <span>Service fee</span>
          <EditableFeeValue fee={serviceFee} />
        </div>
      )}
      {additionalFee && (additionalFeeAmount > 0 || (additionalFee.onChange && !additionalFee.readOnly)) && (
        <div className="verification-fees-total-line verification-fees-total-line--editable">
          <span>Additional fee</span>
          <EditableFeeValue fee={additionalFee} />
        </div>
      )}
      <div className="verification-fees-total-line verification-fees-total-line--grand">
        <span>Total</span>
        <strong>{formatRcFeeAmount(lineGrandTotal)}</strong>
      </div>
    </div>
  );
};
