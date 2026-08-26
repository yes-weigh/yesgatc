import React, { useMemo } from 'react';
import { IndianRupee } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { DEFAULT_RC_FEES_STRUCTURE } from '../lib/rcProfileFields';
import { computeRvCustomerFeeLine, sumRvCustomerFeeLines } from '../lib/rvFeeBreakdown';
import type { VerificationDeviceRowValues } from '../lib/siteCalibrationProfileFields';
import { VerificationFeeBreakdown } from './VerificationFeeBreakdown';
import type { JobType, RcFeesStructure, VerificationLocation } from '../types';

type VerificationFeesTotalSummaryProps = {
  devices: VerificationDeviceRowValues[];
  verificationType?: JobType | '';
  verificationLocation?: VerificationLocation | '';
  verificationSubject?: 'self' | 'customer';
  feesStructure?: RcFeesStructure;
  compact?: boolean;
  readOnly?: boolean;
  onDeviceChange?: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
};

export const VerificationFeesTotalSummary: React.FC<VerificationFeesTotalSummaryProps> = ({
  devices,
  verificationType = 'OV',
  feesStructure,
  compact = false,
  readOnly = false,
  onDeviceChange,
}) => {
  const { products } = useAppContext();
  const isRv = verificationType === 'RV';
  const fees = feesStructure ?? DEFAULT_RC_FEES_STRUCTURE;

  const includedDevices = useMemo(
    () => devices.filter(device => device.included),
    [devices],
  );

  const lines = useMemo(
    () => {
      if (!isRv) return [];
      return includedDevices.flatMap(row => {
        const product = products.find(entry => entry.id === row.productId) ?? null;
        const line = computeRvCustomerFeeLine({
          product,
          fees,
          additionalFee: row.additionalFee,
          discountFee: row.discountFee,
        });
        return line ? [line] : [];
      });
    },
    [fees, includedDevices, isRv, products],
  );

  const summed = useMemo(() => sumRvCustomerFeeLines(lines), [lines]);
  const editRow = includedDevices.length === 1 ? includedDevices[0] : null;
  const canEdit = Boolean(editRow && onDeviceChange && !readOnly);

  if (!isRv || includedDevices.length === 0 || !summed) {
    return null;
  }

  const deviceCountLabel =
    includedDevices.length === 1 ? '1 device' : `${includedDevices.length} devices`;

  return (
    <div className={`verification-fees-summary${compact ? ' verification-fees-summary--compact' : ''}`}>
      <div className="verification-fees-summary-head">
        <div className="verification-fees-summary-head-main">
          <IndianRupee size={compact ? 14 : 16} aria-hidden />
          <p className="verification-fees-summary-title mb-0">Total fees</p>
        </div>
        <span className="verification-fees-summary-meta">{deviceCountLabel}</span>
      </div>

      <VerificationFeeBreakdown
        line={summed}
        variant="total-footer"
        className="verification-fees-summary-breakdown"
        additionalFee={{
          value: editRow ? editRow.additionalFee : String(summed.additionalFee),
          readOnly: !canEdit,
          onChange:
            canEdit && editRow
              ? value => onDeviceChange!(editRow.localId, { additionalFee: value })
              : undefined,
          inputId: editRow ? `verification-review-additional-fee-${editRow.localId}` : undefined,
          ariaLabel: 'Additional fees',
        }}
        discountFee={{
          value: editRow ? editRow.discountFee : String(summed.discount),
          readOnly: !canEdit,
          onChange:
            canEdit && editRow
              ? value => onDeviceChange!(editRow.localId, { discountFee: value })
              : undefined,
          inputId: editRow ? `verification-review-discount-${editRow.localId}` : undefined,
          ariaLabel: 'Discount',
        }}
      />
    </div>
  );
};
