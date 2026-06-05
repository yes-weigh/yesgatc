import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/useAuth';
import { useConfirm } from '../context/ConfirmContext';
import {
  isVerificationCertificateVoided,
  syncVoidSupersededResubmitSources,
} from '../lib/verificationCertificateVoid';
import {
  canResubmitSerialGroup,
  countVoidableCertificatesInGroup,
  getVerificationSerialGroup,
  pickResubmitSourceForSerialGroup,
  resubmitSerialGroupForDoca,
  sortVerificationSerialGroupForDisplay,
  verificationVersionSubtitle,
  verificationVersionTitle,
} from '../lib/verificationResubmit';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationCertificatePreview } from './VerificationCertificatePreview';
import { VerificationDetailsCard } from './VerificationDetailsCard';
import { VerificationSummaryChrome } from './VerificationSummaryChrome';
import type { SiteCalibration } from '../types';

type VerificationSerialGroupViewProps = {
  record: SiteCalibration;
  allRecords: SiteCalibration[];
  customerPhone?: string | null;
  onClose: () => void;
  onResubmitted?: (newRecordId: string) => void | Promise<void>;
  closeDisabled?: boolean;
  showHeaderClose?: boolean;
};

function versionTone(record: SiteCalibration, group: SiteCalibration[]): string {
  const title = verificationVersionTitle(record, group);
  if (title === 'Void certificate') return 'void';
  if (title === 'Corrupted certificate') return 'corrupted';
  if (title === 'Correct certificate') return 'correct';
  if (title === 'Resubmission in progress') return 'pending';
  return 'default';
}

export const VerificationSerialGroupView: React.FC<VerificationSerialGroupViewProps> = ({
  record,
  allRecords,
  customerPhone,
  onClose,
  onResubmitted,
  closeDisabled = false,
  showHeaderClose = false,
}) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [resubmitting, setResubmitting] = useState(false);
  const [error, setError] = useState('');

  const group = useMemo(
    () => getVerificationSerialGroup(allRecords, record),
    [allRecords, record],
  );

  const sortedGroup = useMemo(
    () => sortVerificationSerialGroupForDisplay(group),
    [group],
  );

  const isSuperAdmin = user?.role === 'super_admin';
  const resubmitSource = useMemo(
    () => pickResubmitSourceForSerialGroup(group, record),
    [group, record],
  );
  const showSerialResubmit = isSuperAdmin && canResubmitSerialGroup(group, record);
  const voidOthersCount = resubmitSource
    ? countVoidableCertificatesInGroup(group, resubmitSource.id)
    : 0;

  const groupSyncKey = useMemo(
    () =>
      group
        .map(
          r =>
            `${r.id}:${r.certificateVoidedAt ?? ''}:${r.status ?? ''}:${r.resubmittedFromId ?? ''}`,
        )
        .join('|'),
    [group],
  );

  useEffect(() => {
    if (!isSuperAdmin || !user?.uid) return;
    void syncVoidSupersededResubmitSources(db, group, user.uid)
      .then(() => onResubmitted?.(record.id))
      .catch(() => {
        /* worker may have already voided the source */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when void/cert state changes
  }, [groupSyncKey, isSuperAdmin, user?.uid]);

  const showGroupHeading = group.length > 1;

  const handleSerialResubmit = async () => {
    if (!user?.uid || !isSuperAdmin || !resubmitSource) return;

    const voidLine =
      voidOthersCount > 0
        ? `${voidOthersCount} other certificate${voidOthersCount === 1 ? '' : 's'} for this serial will be marked void.\n\n`
        : '';

    const ok = await confirm({
      title: 'Resubmit on DOCA?',
      message:
        `Queue a new verification for serial ${record.serialNumber?.trim() || '—'}?\n\n` +
        voidLine +
        `Resubmit uses app ${resubmitSource.applicationNumber?.trim() || '—'} as the source. ` +
        'When the new certificate is issued, that source is voided automatically.',
      confirmLabel: 'Resubmit',
      destructive: true,
    });
    if (!ok) return;

    setError('');
    setResubmitting(true);
    try {
      const result = await resubmitSerialGroupForDoca(db, group, user.uid, record);
      await onResubmitted?.(result.newRecordId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit verification.');
    } finally {
      setResubmitting(false);
    }
  };

  return (
    <div className="verification-certified-summary verification-serial-group">
      {showGroupHeading && (
        <p className="verification-serial-group-hint verification-serial-group-hint--top mb-0">
          {group.length} records for this serial
        </p>
      )}

      {error && (
        <p className="verification-serial-group-error mb-0" role="alert">
          {error}
        </p>
      )}

      <div className="verification-serial-group-versions">
        {sortedGroup.map(version => {
          const tone = versionTone(version, group);
          const showActions = canShowVerificationCertifiedActions(version);
          const isVoided = isVerificationCertificateVoided(version);

          return (
            <article
              key={version.id}
              className={`verification-version-card verification-version-card--${tone}${
                isVoided ? ' verification-version-card--voided' : ''
              }${showActions ? ' verification-version-card--has-preview' : ''}`}
            >
              <div className="verification-version-card-layout">
                <div className="verification-version-card-main">
                  <VerificationSummaryChrome
                    record={version}
                    onClose={onClose}
                    closeDisabled={closeDisabled || resubmitting}
                    showClose={showHeaderClose && version.id === record.id}
                    versionHint={
                      showGroupHeading
                        ? `${verificationVersionTitle(version, group)} · ${verificationVersionSubtitle(version)}`
                        : undefined
                    }
                  />

                  {showActions && (
                    <VerificationCertifiedActions record={version} customerPhone={customerPhone} />
                  )}

                  <VerificationDetailsCard record={version} />
                </div>

                {showActions && (
                  <VerificationCertificatePreview
                    record={version}
                    className="verification-certificate-preview--desktop-only"
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>

      {showSerialResubmit && (
        <div className="verification-serial-group-resubmit verification-serial-group-resubmit--footer">
          {voidOthersCount > 0 && (
            <p className="verification-serial-group-resubmit-hint mb-0">
              Marks {voidOthersCount} other certificate{voidOthersCount === 1 ? '' : 's'} as void,
              then queues one new run.
            </p>
          )}
          <button
            type="button"
            className="verification-form-btn verification-form-btn--resubmit"
            disabled={resubmitting || closeDisabled}
            onClick={() => void handleSerialResubmit()}
          >
            {resubmitting ? (
              <span className="spinner-inline" aria-hidden />
            ) : (
              <RefreshCw size={16} aria-hidden />
            )}
            <span>Resubmit on DOCA</span>
          </button>
        </div>
      )}
    </div>
  );
};
