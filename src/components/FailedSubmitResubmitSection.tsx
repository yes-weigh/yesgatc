import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/useAuth';
import { useConfirm } from '../context/ConfirmContext';
import {
  canActorResubmitFailedSubmit,
} from '../lib/verificationFailedSubmitResubmit';
import { resubmitFailedSubmitVerification } from '../lib/verificationFailedSubmitWrite';
import type { SiteCalibration } from '../types';

type FailedSubmitResubmitSectionProps = {
  record: SiteCalibration;
  onResubmitted?: () => void | Promise<void>;
  className?: string;
};

export const FailedSubmitResubmitSection: React.FC<FailedSubmitResubmitSectionProps> = ({
  record,
  onResubmitted,
  className = '',
}) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canActorResubmitFailedSubmit(record, { role: user?.role, uid: user?.uid })) {
    return null;
  }

  const appNo = record.applicationNumber?.trim() || '—';
  const serial = record.serialNumber?.trim() || '—';

  const handleResubmit = async () => {
    const ok = await confirm({
      title: 'Resubmit for certification?',
      message: [
        `Re-queue App ${appNo} (serial ${serial}) for eMAAP.`,
        '',
        'Same certificate job. Application number is kept.',
        'Worker picks it up again after the fail markers clear.',
      ].join('\n'),
      messageFormat: 'preline',
      confirmLabel: 'Resubmit',
    });
    if (!ok) return;

    setBusy(true);
    setError('');
    try {
      await resubmitFailedSubmitVerification(record.id, 'manual', db);
      await onResubmitted?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit verification.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`failed-submit-resubmit ${className}`.trim()}>
      <div className="failed-submit-resubmit__inner glass">
        <div className="failed-submit-resubmit__text">
          <p className="failed-submit-resubmit__label text-muted text-xs mb-1">Failed at submit</p>
          <p className="failed-submit-resubmit__title mb-0">Resubmit</p>
          <p className="text-muted text-sm mb-0">
            Queue the same job again. Keeps application number.
          </p>
          {error && (
            <p className="form-error text-sm mb-0 mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void handleResubmit()}
        >
          <Send size={14} aria-hidden />
          {busy ? 'Resubmitting…' : 'Resubmit'}
        </button>
      </div>
    </div>
  );
};
