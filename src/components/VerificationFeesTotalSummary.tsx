import React, { useMemo } from 'react';
import { IndianRupee } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import {
  DEFAULT_RC_FEES_STRUCTURE,
  rcVerificationFeeQuote,
  rvGatewayFee,
  rvTdsFee,
  sumRcVerificationFees,
  verificationFeeWithGst,
} from '../lib/rcProfileFields';
import { parseAdditionalFeeInput, parseServiceFeeInput } from '../lib/verificationDocaCharges';
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
};

export const VerificationFeesTotalSummary: React.FC<VerificationFeesTotalSummaryProps> = ({
  devices,
  verificationType = 'OV',
  verificationLocation = '',
  verificationSubject = 'customer',
  feesStructure,
  compact = false,
}) => {
  const { products } = useAppContext();
  const isRv = verificationType === 'RV';
  const useSelfFees = verificationSubject === 'self';
  const fees = feesStructure ?? DEFAULT_RC_FEES_STRUCTURE;

  const includedDevices = useMemo(
    () => devices.filter(device => device.included),
    [devices],
  );

  const deviceFeeLines = useMemo(() => {
    if (!isRv) return [];
    return includedDevices.map(row => {
      const product = products.find(entry => entry.id === row.productId) ?? null;
      return rcVerificationFeeQuote(
        fees,
        verificationLocation,
        product,
        verificationSubject,
        verificationType,
      );
    });
  }, [fees, includedDevices, isRv, products, verificationLocation, verificationSubject, verificationType]);

  const serviceFeeTotal = useMemo(
    () =>
      includedDevices.reduce((sum, row) => sum + parseServiceFeeInput(row.serviceFee), 0),
    [includedDevices],
  );

  const additionalFeeTotal = useMemo(
    () =>
      includedDevices.reduce((sum, row) => sum + parseAdditionalFeeInput(row.additionalFee), 0),
    [includedDevices],
  );

  const tdsTotal = useMemo(
    () =>
      includedDevices.reduce((sum, row) => {
        const product = products.find(entry => entry.id === row.productId) ?? null;
        return sum + rvTdsFee(product);
      }, 0),
    [includedDevices, products],
  );

  const gatewayFeeTotal = useMemo(
    () =>
      includedDevices.reduce((sum, row) => {
        const product = products.find(entry => entry.id === row.productId) ?? null;
        return sum + rvGatewayFee(product);
      }, 0),
    [includedDevices, products],
  );

  const feeTotals = useMemo(() => {
    const base = sumRcVerificationFees(deviceFeeLines);
    return verificationFeeWithGst(base);
  }, [deviceFeeLines]);

  const canCalculateFees = isRv || Boolean(verificationLocation) || useSelfFees;

  if (!isRv || includedDevices.length === 0) {
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
        {canCalculateFees ? (
          <span className="verification-fees-summary-meta">{deviceCountLabel}</span>
        ) : (
          <span className="text-muted text-xs">Select location to calculate fees</span>
        )}
      </div>

      {canCalculateFees && (
        <VerificationFeeBreakdown
          baseAmount={feeTotals.base}
          variant="total-footer"
          className="verification-fees-summary-breakdown"
          tdsTotal={tdsTotal}
          gatewayFeeTotal={gatewayFeeTotal}
          serviceFeeTotal={serviceFeeTotal}
          additionalFeeTotal={additionalFeeTotal}
        />
      )}
    </div>
  );
};
