import React from 'react';
import { formatRcFeeAmount, VERIFICATION_FEE_GST_RATE } from '../lib/rcProfileFields';
import type { RvCustomerFeeLine } from '../lib/rvFeeBreakdown';
import { parseAdditionalFeeInput } from '../lib/verificationDocaCharges';

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
  line: RvCustomerFeeLine;
  variant?: VerificationFeeBreakdownVariant;
  className?: string;
  additionalFee?: VerificationEditableFeeProps;
  discountFee?: VerificationEditableFeeProps;
};

function editableFeeAmount(fee?: VerificationEditableFeeProps): number {
  if (!fee) return 0;
  return parseAdditionalFeeInput(fee.value);
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

  return <span>{formatRcFeeAmount(parseAdditionalFeeInput(fee.value))}</span>;
}

function FeeRows({
  line,
  lineClassName,
  additionalFee,
  discountFee,
  showZeroExtras,
}: {
  line: RvCustomerFeeLine;
  lineClassName: string;
  additionalFee?: VerificationEditableFeeProps;
  discountFee?: VerificationEditableFeeProps;
  showZeroExtras: boolean;
}) {
  const additionalAmount = editableFeeAmount(additionalFee);
  const discountAmount = editableFeeAmount(discountFee);
  const showAdditional =
    Boolean(additionalFee) &&
    (showZeroExtras || additionalAmount > 0 || Boolean(additionalFee?.onChange && !additionalFee.readOnly));
  const showDiscount =
    Boolean(discountFee) &&
    (showZeroExtras || discountAmount > 0 || Boolean(discountFee?.onChange && !discountFee.readOnly));

  return (
    <>
      <div className={`${lineClassName} verification-fees-total-line--primary`}>
        <span>GATC verification fees</span>
        <span>{formatRcFeeAmount(line.gatcFee)}</span>
      </div>
      <div className={`${lineClassName} verification-fees-total-line--section`}>
        <span>GST ({GST_PERCENT_LABEL})</span>
        <span>{formatRcFeeAmount(line.gst)}</span>
      </div>
      <div className={lineClassName}>
        <span>RC fees</span>
        <span>{formatRcFeeAmount(line.rcFees)}</span>
      </div>
      {showAdditional && additionalFee ? (
        <div className={`${lineClassName} verification-fees-total-line--editable`}>
          <span>Additional fees</span>
          <EditableFeeValue fee={additionalFee} />
        </div>
      ) : null}
      {showDiscount && discountFee ? (
        <div className={`${lineClassName} verification-fees-total-line--editable`}>
          <span>Discount</span>
          <EditableFeeValue fee={discountFee} />
        </div>
      ) : null}
      <div className={`${lineClassName} verification-fees-total-line--net`}>
        <span>Net RC fees</span>
        <span>{formatRcFeeAmount(line.netRcFees)}</span>
      </div>
      <div className={`${lineClassName} verification-fees-total-line--grand`}>
        <span>Total</span>
        <strong>{formatRcFeeAmount(line.total)}</strong>
      </div>
    </>
  );
}

export const VerificationFeeBreakdown: React.FC<VerificationFeeBreakdownProps> = ({
  line,
  variant = 'cell',
  className = '',
  additionalFee,
  discountFee,
}) => {
  const rootClass = ['verification-fee-breakdown', `verification-fee-breakdown--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  if (variant === 'inline') {
    return (
      <span className={rootClass}>
        <span className="verification-fee-breakdown-base">{formatRcFeeAmount(line.total)}</span>
      </span>
    );
  }

  const lineClassName =
    variant === 'summary-rows' ? 'verification-fee-breakdown-row' : 'verification-fees-total-line';

  return (
    <div className={rootClass}>
      <FeeRows
        line={line}
        lineClassName={lineClassName}
        additionalFee={additionalFee}
        discountFee={discountFee}
        showZeroExtras={variant === 'cell' || variant === 'total-footer'}
      />
    </div>
  );
};
