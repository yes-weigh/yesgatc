import React, { useState } from 'react';
import { FileInput } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { useConfirm } from '../context/ConfirmContext';
import {
  canMoveFailedSubmitToDraft,
  moveFailedSubmitVerificationToDraft,
} from '../lib/verificationPipelineRepair';
import type { SiteCalibration } from '../types';

type FailedSubmitMoveToDraftSectionProps = {
  record: SiteCalibration;
  onMoved?: () => void | Promise<void>;
  className?: string;
};

export const FailedSubmitMoveToDraftSection: React.FC<FailedSubmitMoveToDraftSectionProps> = ({
  record,
  onMoved,
  className = '',
}) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isSuperAdmin = user?.role === 'super_admin';

  if (!canMoveFailedSubmitToDraft(record, isSuperAdmin)) return null;

  const appNo = record.applicationNumber?.trim() || '—';
  const serial = record.serialNumber?.trim() || '—';

  const handleMove = async () => {
    const ok = await confirm({
      title: 'Move to draft?',
      message: [
        `Move App ${appNo} (serial ${serial}) back to draft?`,
        '',
        'RC/VCT can then open it, fix photos or pincode, and submit again.',
        'Application number is kept. Worker will not process it until resubmitted.',
      ].join('\n'),
      messageFormat: 'preline',
      confirmLabel: 'Move to draft',
    });
    if (!ok) return;

    setBusy(true);
    setError('');
    try {
      await moveFailedSubmitVerificationToDraft(record.id);
      await onMoved?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to move verification to draft.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`failed-submit-move-draft ${className}`.trim()}>
      <div className="failed-submit-move-draft__inner glass">
        <div className="failed-submit-move-draft__text">
          <p className="failed-submit-move-draft__label text-muted text-xs mb-1">Super Admin</p>
          <p className="failed-submit-move-draft__title mb-0">Move to draft</p>
          <p className="text-muted text-sm mb-0">
            Lets RC/VCT fix missing photos or pincode, then resubmit. Keeps application number.
          </p>
          {record.pipelineFailureMessage?.trim() && (
            <p className="text-muted text-xs mb-0 mt-2" role="status">
              Failure: {record.pipelineFailureMessage.trim()}
            </p>
          )}
          {error && (
            <p className="form-error text-sm mb-0 mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => void handleMove()}
        >
          <FileInput size={14} aria-hidden />
          {busy ? 'Moving…' : 'Move to draft'}
        </button>
      </div>
    </div>
  );
};
