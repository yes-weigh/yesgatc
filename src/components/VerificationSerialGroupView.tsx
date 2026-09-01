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
  canQueueEmaapResubmit,
  canEditResubmitOvSerialGroup,
  canResubmitSerialGroup,
  countVoidableCertificatesInGroup,
  findOpenOvResubmitDraft,
  getVerificationSerialGroup,
  pickOvEditResubmitSource,
  pickResubmitSourceForSerialGroup,
  resubmitOvSerialGroupForEdit,
  resubmitSerialGroupForDoca,
  sortVerificationSerialGroupForDisplay,
  verificationVersionSubtitle,
  verificationVersionTitle,
} from '../lib/verificationResubmit';
import {
  canShowVerificationCertifiedActions,
  isCertificationFailureResubmitSource,
} from '../lib/verificationRequest';
import { VerificationCertifiedActions } from './VerificationCertifiedActions';
import { VerificationCertificatePreview } from './VerificationCertificatePreview';
import { VerificationDetailsCard } from './VerificationDetailsCard';
import { VerificationSummaryChrome } from './VerificationSummaryChrome';
import { RvLegacyWalletPaymentSection } from './RvLegacyWalletPaymentSection';
import { RvLegacyZohoInvoiceSection } from './RvLegacyZohoInvoiceSection';
import { RvLegacyZohoSettlementSection } from './RvLegacyZohoSettlementSection';
import { RvSubmitTestRevertSection } from './RvSubmitTestRevertSection';
import { canRevertRvSubmitTest } from '../lib/rvSubmitTestRevert';
import { ListViewBackBar } from './ListViewBackBar';
import type { Customer, Product, SiteCalibration } from '../types';
import type { VerificationRcPartyProfile } from '../lib/verificationPartyDetails';

type VerificationSerialGroupViewProps = {
  record: SiteCalibration;
  allRecords: SiteCalibration[];
  rcCenterName?: string;
  customer?: Customer | null;
  product?: Product | null;
  rcProfile?: VerificationRcPartyProfile | null;
  onClose: () => void;
  onResubmitted?: (newRecordId: string) => void | Promise<void>;
  onPaymentRecorded?: () => void | Promise<void>;
  closeDisabled?: boolean;
};

function versionTone(record: SiteCalibration, group: SiteCalibration[]): string {
  const title = verificationVersionTitle(record, group);
  if (title === 'Void certificate') return 'void';
  if (title === 'Corrupted certificate') return 'corrupted';
  if (title === 'Certification failed') return 'corrupted';
  if (title === 'Correct certificate') return 'correct';
  if (title === 'Resubmission in progress') return 'pending';
  if (title === 'Resubmit draft') return 'pending';
  return 'default';
}

export const VerificationSerialGroupView: React.FC<VerificationSerialGroupViewProps> = ({
  record,
  allRecords,
  rcCenterName,
  customer = null,
  product = null,
  rcProfile = null,
  onClose,
  onResubmitted,
  onPaymentRecorded,
  closeDisabled = false,
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
  const canQueueResubmit = canQueueEmaapResubmit(user?.role);
  const ovDraft = useMemo(() => findOpenOvResubmitDraft(group), [group]);
  const ovResubmitSource = useMemo(
    () => pickOvEditResubmitSource(group, record),
    [group, record],
  );
  const resubmitSource = useMemo(
    () => pickResubmitSourceForSerialGroup(group, record),
    [group, record],
  );
  const showOvEditResubmit =
    canQueueResubmit
    && record.verificationType === 'OV'
    && canEditResubmitOvSerialGroup(group, record);
  const showRvEmaapResubmit =
    canQueueResubmit
    && record.verificationType === 'RV'
    && canResubmitSerialGroup(group, record);
  const certificationFailureSource =
    record.verificationType === 'RV'
    && resubmitSource
    && isCertificationFailureResubmitSource(resubmitSource);
  const showDevRvWipe = canRevertRvSubmitTest(record, isSuperAdmin);
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
    if (!canQueueResubmit || !user?.uid) return;
    void syncVoidSupersededResubmitSources(db, group, user.uid)
      .then(() => onResubmitted?.(record.id))
      .catch(() => {
        /* worker may have already voided the source */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when void/cert state changes
  }, [groupSyncKey, canQueueResubmit, user?.uid]);

  const showGroupHeading = group.length > 1;

  const handleOvEditResubmit = async () => {
    if (!user?.uid || !canQueueResubmit) return;

    const resume = ovDraft != null;
    const sourceApp = (ovDraft ?? ovResubmitSource)?.applicationNumber?.trim() || '—';
    const ok = await confirm({
      title: resume ? 'Continue resubmit?' : 'Resubmit verification?',
      message: resume
        ? `An unpublished resubmit draft already exists for serial ${record.serialNumber?.trim() || '—'} (app ${sourceApp}). Open it to edit and submit. Serial stays locked. The old certificate is hidden when you submit.`
        : `Create a new draft for serial ${record.serialNumber?.trim() || '—'}?\n\nNew application number. Same serial (locked). Photos and details are copied — edit anything except serial, then submit.\n\nThe old certificate stays visible until you submit the draft. On submit it is hidden (not deleted).`,
      confirmLabel: resume ? 'Continue' : 'Resubmit',
      destructive: !resume,
    });
    if (!ok) return;

    setError('');
    setResubmitting(true);
    try {
      const result = await resubmitOvSerialGroupForEdit(db, group, user.uid, record);
      await onResubmitted?.(result.newRecordId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit verification.');
    } finally {
      setResubmitting(false);
    }
  };

  const handleSerialResubmit = async () => {
    if (!user?.uid || !canQueueResubmit || !resubmitSource) return;

    const voidLine =
      voidOthersCount > 0
        ? `${voidOthersCount} other certificate${voidOthersCount === 1 ? '' : 's'} for this serial will be marked void.\n\n`
        : '';

    const ok = await confirm({
      title: certificationFailureSource ? 'Resubmit after certification failure?' : 'Resubmit for eMAAP?',
      message:
        `Queue a new verification for serial ${record.serialNumber?.trim() || '—'}?\n\n` +
        voidLine +
        (certificationFailureSource
          ? 'The failed record is superseded — the worker will not retry it. '
          : '') +
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
      <ListViewBackBar
        onBack={onClose}
        disabled={closeDisabled || resubmitting}
      />

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

      <RvLegacyWalletPaymentSection
        record={record}
        rcCenterName={rcCenterName}
        onPaymentRecorded={async () => {
          await onPaymentRecorded?.();
          await onResubmitted?.(record.id);
        }}
        className="verification-serial-group-payment-banner"
      />
      <RvLegacyZohoInvoiceSection
        record={record}
        rcCenterName={rcCenterName}
        onInvoicePushed={async () => {
          await onPaymentRecorded?.();
          await onResubmitted?.(record.id);
        }}
        className="verification-serial-group-payment-banner"
      />
      <RvLegacyZohoSettlementSection
        record={record}
        onSettled={async () => {
          await onPaymentRecorded?.();
          await onResubmitted?.(record.id);
        }}
        className="verification-serial-group-payment-banner"
      />
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
                    rcCenterName={rcCenterName}
                    versionHint={
                      showGroupHeading
                        ? `${verificationVersionTitle(version, group)} · ${verificationVersionSubtitle(version)}`
                        : undefined
                    }
                  />

                  {showActions && (
                    <VerificationCertifiedActions record={version} />
                  )}

                  <VerificationDetailsCard
                    record={version}
                    customer={customer}
                    product={product}
                    rcProfile={rcProfile}
                  />
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

      {(showOvEditResubmit || showRvEmaapResubmit || showDevRvWipe) && (
        <div className="verification-serial-group-resubmit verification-serial-group-resubmit--footer">
          {showRvEmaapResubmit && voidOthersCount > 0 && (
            <p className="verification-serial-group-resubmit-hint mb-0">
              Marks {voidOthersCount} other certificate{voidOthersCount === 1 ? '' : 's'} as void,
              then queues one new run.
            </p>
          )}
          {showOvEditResubmit && (
            <p className="verification-serial-group-resubmit-hint mb-0">
              {ovDraft
                ? 'Open the unpublished draft. Serial stays locked. Old certificate hides on submit.'
                : 'Opens a new draft with the same serial. Old certificate hides when you submit — PDFs are kept.'}
            </p>
          )}
          <div className="verification-serial-group-footer-actions">
            {showDevRvWipe && (
              <RvSubmitTestRevertSection
                record={record}
                allRecords={allRecords}
                rcCenterName={rcCenterName}
                onReverted={async () => {
                  await onPaymentRecorded?.();
                  onClose();
                }}
                className="rv-submit-test-revert--footer"
              />
            )}
            {showOvEditResubmit && (
              <button
                type="button"
                className="verification-form-btn verification-form-btn--resubmit"
                disabled={resubmitting || closeDisabled}
                onClick={() => void handleOvEditResubmit()}
              >
                {resubmitting ? (
                  <span className="spinner-inline" aria-hidden />
                ) : (
                  <RefreshCw size={16} aria-hidden />
                )}
                <span>{ovDraft ? 'Continue resubmit' : 'Resubmit'}</span>
              </button>
            )}
            {showRvEmaapResubmit && (
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
                <span>Resubmit for eMAAP</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
