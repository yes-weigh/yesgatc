import React, { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { useConfirm } from '../context/ConfirmContext';
import { normalizeVerificationStatus } from '../lib/verificationRequest';
import {
  buildRvSubmitTestRevertMessage,
  canRevertRvSubmitTest,
  collectRvSubmitBatchForDisplay,
  revertRvSubmitTest,
} from '../lib/rvSubmitTestRevert';
import type { SiteCalibration } from '../types';

type RvSubmitTestRevertSectionProps = {
  record: SiteCalibration;
  allRecords?: SiteCalibration[];
  rcCenterName?: string;
  onReverted?: () => void | Promise<void>;
  className?: string;
};

export const RvSubmitTestRevertSection: React.FC<RvSubmitTestRevertSectionProps> = ({
  record,
  allRecords = [],
  rcCenterName,
  onReverted,
  className = '',
}) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState('');
  const isSuperAdmin = user?.role === 'super_admin';

  const batch = useMemo(
    () => collectRvSubmitBatchForDisplay(
      record,
      allRecords.length ? allRecords : [record],
      isSuperAdmin,
    ),
    [record, allRecords, isSuperAdmin],
  );

  if (!canRevertRvSubmitTest(record, isSuperAdmin)) return null;

  const status = normalizeVerificationStatus(record);
  const isCertifiedWipe = status === 'certified' || status === 'approved';

  const rcName = rcCenterName?.trim() || 'Regional Center';

  const handleRevert = async () => {
    const ok = await confirm({
      title: isCertifiedWipe
        ? 'Wipe certified RV test data? (dev only)'
        : 'Revert RV submit test? (dev only)',
      message: buildRvSubmitTestRevertMessage(batch, rcName),
      messageFormat: 'preline',
      confirmLabel: 'Revert Firebase data',
      destructive: true,
    });
    if (!ok) return;

    setReverting(true);
    setError('');
    try {
      await revertRvSubmitTest(record.id);
      await onReverted?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'RV test revert failed.');
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className={`rv-submit-test-revert ${className}`.trim()}>
      <div className="rv-submit-test-revert__inner glass">
        <div className="rv-submit-test-revert__text">
          <p className="rv-submit-test-revert__label text-muted text-xs mb-1">Dev testing</p>
          <p className="rv-submit-test-revert__title mb-0">
            {isCertifiedWipe
              ? `Dev wipe — certified RV (${batch.length} record${batch.length === 1 ? '' : 's'})`
              : `One-click revert for submitted RV (${batch.length} record${batch.length === 1 ? '' : 's'})`}
          </p>
          <p className="text-muted text-sm mb-0">
            Deletes Firebase records, restores wallet, and lists Zoho entries to remove manually.
          </p>
          {error && (
            <p className="form-error text-sm mb-0 mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={reverting}
          onClick={() => void handleRevert()}
        >
          <RotateCcw size={14} aria-hidden />
          {reverting ? 'Reverting…' : isCertifiedWipe ? 'Wipe RV test data' : 'Revert submit test'}
        </button>
      </div>
    </div>
  );
};
