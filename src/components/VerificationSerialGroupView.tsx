import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../context/useAuth';
import { useConfirm } from '../context/ConfirmContext';
import {
  canResubmitVerification,
  getVerificationSerialGroup,
  resubmitVerificationForDoca,
  verificationVersionSubtitle,
  verificationVersionTitle,
} from '../lib/verificationResubmit';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationCertificatePreview } from './VerificationCertificatePreview';
import { VerificationDetailsCard } from './VerificationDetailsCard';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import type { SiteCalibration } from '../types';

type VerificationSerialGroupViewProps = {
  record: SiteCalibration;
  allRecords: SiteCalibration[];
  customerPhone?: string | null;
  onClose: () => void;
  onResubmitted?: (newRecordId: string) => void | Promise<void>;
  closeDisabled?: boolean;
};

function versionTone(record: SiteCalibration, group: SiteCalibration[]): string {
  const title = verificationVersionTitle(record, group);
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
}) => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [resubmittingId, setResubmittingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const group = useMemo(
    () => getVerificationSerialGroup(allRecords, record),
    [allRecords, record],
  );

  const isSuperAdmin = user?.role === 'super_admin';
  const showGroupHeading = group.length > 1;

  const handleResubmit = async (source: SiteCalibration) => {
    if (!user?.uid || !isSuperAdmin) return;

    const ok = await confirm({
      title: 'Resubmit on DOCA?',
      message:
        `Queue a new submitted verification for serial ${source.serialNumber?.trim() || '—'}?\n\n` +
        'The current certificate will be marked as corrupted. A duplicate record is created for the certificate server.',
      confirmLabel: 'Resubmit',
      destructive: true,
    });
    if (!ok) return;

    setError('');
    setResubmittingId(source.id);
    try {
      const result = await resubmitVerificationForDoca(db, source, user.uid);
      await onResubmitted?.(result.newRecordId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit verification.');
    } finally {
      setResubmittingId(null);
    }
  };

  return (
    <div className="verification-certified-summary verification-serial-group">
      <div className="verification-certified-summary-head">
        <h2 id="site-calibration-form-title" className="verification-certified-summary-title">
          {record.customerName || 'Verification'}
        </h2>
        {record.serialNumber?.trim() && (
          <p className="verification-certified-summary-cert text-mono mb-0">
            Serial {record.serialNumber.trim()}
          </p>
        )}
        {showGroupHeading && (
          <p className="verification-serial-group-hint mb-0">
            {group.length} records for this serial
          </p>
        )}
      </div>

      {error && (
        <p className="verification-serial-group-error mb-0" role="alert">
          {error}
        </p>
      )}

      <div className="verification-serial-group-versions">
        {group.map(version => {
          const tone = versionTone(version, group);
          const showActions = canShowVerificationCertifiedActions(version);
          const showResubmit =
            isSuperAdmin && canResubmitVerification(version, group);

          return (
            <article
              key={version.id}
              className={`verification-version-card verification-version-card--${tone}${
                showActions ? ' verification-version-card--has-preview' : ''
              }`}
            >
              <div className="verification-version-card-layout">
                <div className="verification-version-card-main">
                  <header className="verification-version-card-head">
                    <div className="verification-version-card-head-text">
                      <h3 className="verification-version-card-title">
                        {verificationVersionTitle(version, group)}
                      </h3>
                      <p className="verification-version-card-subtitle mb-0">
                        {verificationVersionSubtitle(version)}
                      </p>
                    </div>
                    <VerificationStatusBadge record={version} />
                  </header>

                  {showActions && (
                    <VerificationCertifiedActions record={version} customerPhone={customerPhone} />
                  )}

                  <VerificationDetailsCard record={version} />

                  {showResubmit && (
                    <button
                      type="button"
                      className="verification-form-btn verification-form-btn--resubmit"
                      disabled={Boolean(resubmittingId) || closeDisabled}
                      onClick={() => void handleResubmit(version)}
                    >
                      {resubmittingId === version.id ? (
                        <span className="spinner-inline" aria-hidden />
                      ) : (
                        <RefreshCw size={16} aria-hidden />
                      )}
                      <span>Resubmit on DOCA</span>
                    </button>
                  )}
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

      <div className="verification-certified-summary-footer">
        <div className="product-form-footer verification-form-footer verification-form-footer--certified-summary">
          <div className="verification-form-footer-row verification-form-footer-row--actions">
            <button
              type="button"
              className="verification-form-btn verification-form-btn--cancel"
              onClick={onClose}
              disabled={closeDisabled || Boolean(resubmittingId)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
