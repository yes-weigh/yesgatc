import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Eye } from 'lucide-react';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { InlineFormPanel } from './InlineFormPanel';
import { StorageImage } from './StorageImage';
import { VerificationSerialGroupView } from './VerificationSerialGroupView';
import { ListViewBackBar } from './ListViewBackBar';
import { RvOutstandingWalletPaymentBanner } from './RvOutstandingWalletPaymentBanner';
import { RvWalletPaymentPanel } from './RvWalletPaymentPanel';
import { getVerificationSerialGroup } from '../lib/verificationResubmit';
import { VERIFICATION_LOCATION_OPTIONS } from '../lib/siteCalibrationProfileFields';
import { resolveRcFeesStructure } from '../lib/rcProfileFields';
import {
  buildRvPaymentFirestorePatch,
  computeRvPaymentBreakdownForRecord,
  isRvWalletPaymentOutstanding,
} from '../lib/rvPaymentAmount';
import {
  isWalletPaymentId,
  linkWalletPaymentToRecords,
  refundRvWalletPayment,
} from '../lib/rcWallet';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import {
  canShowVerificationCertifiedActions,
  formatVerificationCapAcc,
  verificationVctLabel,
} from '../lib/verificationRequest';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

interface VerificationDetailPanelProps {
  record: SiteCalibration;
  allRecords?: SiteCalibration[];
  rcCenterName?: string;
  onClose: () => void;
  onRecordsChanged?: (newRecordId?: string) => void | Promise<void>;
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function locationLabel(value?: SiteCalibration['verificationLocation']): string {
  if (!value) return '—';
  return VERIFICATION_LOCATION_OPTIONS.find(opt => opt.value === value)?.label ?? value;
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="verification-detail-field">
      <span className="verification-detail-label">{label}</span>
      <span className="verification-detail-value">{value || '—'}</span>
    </div>
  );
}

function DetailImage({
  label,
  url,
  path,
  name,
}: {
  label: string;
  url?: string;
  path?: string;
  name?: string;
}) {
  if (!url && !path) return null;
  return (
    <div className="verification-detail-image">
      <span className="verification-detail-label">{label}</span>
      <StorageImage url={url} path={path} alt={name || label} className="verification-detail-image-thumb" />
    </div>
  );
}

export const VerificationDetailPanel: React.FC<VerificationDetailPanelProps> = ({
  record,
  allRecords = [],
  rcCenterName,
  onClose,
  onRecordsChanged,
}) => {
  const { user } = useAuth();
  const { products } = useAppContext();
  const { appSettings } = useAppSettings();
  const [rcProfile, setRcProfile] = useState<FirestoreUserDoc | null>(null);
  const [legacyPaymentOpen, setLegacyPaymentOpen] = useState(false);
  const [legacyPaying, setLegacyPaying] = useState(false);
  const [legacyPaymentError, setLegacyPaymentError] = useState('');

  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
    const rcId = record.rcId?.trim();
    if (!rcId) {
      setRcProfile(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', rcId));
        if (!cancelled) {
          setRcProfile(snap.exists() ? (snap.data() as FirestoreUserDoc) : null);
        }
      } catch {
        if (!cancelled) setRcProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [record.rcId]);

  const legacyPaymentBreakdown = useMemo(
    () =>
      computeRvPaymentBreakdownForRecord(
        record,
        products,
        resolveRcFeesStructure(rcProfile),
      ),
    [record, products, rcProfile],
  );

  const showLegacyPaymentBanner =
    isRvWalletPaymentOutstanding(record, appSettings)
    && legacyPaymentBreakdown != null
    && legacyPaymentBreakdown.total > 0;

  const handleLegacyPaymentComplete = async (paymentId: string) => {
    if (!legacyPaymentBreakdown || !record.rcId) return;
    setLegacyPaymentOpen(false);
    const walletPaymentId = isWalletPaymentId(paymentId) ? paymentId : null;
    setLegacyPaying(true);
    setLegacyPaymentError('');
    try {
      await updateDoc(doc(db, 'siteCalibrations', record.id), {
        ...buildRvPaymentFirestorePatch(paymentId, legacyPaymentBreakdown.total),
      });
      if (walletPaymentId) {
        await linkWalletPaymentToRecords({
          paymentId: walletPaymentId,
          recordIds: [record.id],
        });
      }
      await onRecordsChanged?.();
    } catch (err: unknown) {
      if (walletPaymentId) {
        try {
          await refundRvWalletPayment({
            paymentId: walletPaymentId,
            reason: 'Failed to record legacy wallet payment on verification',
          });
        } catch {
          setLegacyPaymentError(
            `${err instanceof Error ? err.message : 'Failed to record payment.'} Wallet refund could not be completed automatically — contact support with payment id ${walletPaymentId}.`,
          );
          return;
        }
      }
      setLegacyPaymentError(
        err instanceof Error ? err.message : 'Failed to record payment on verification.',
      );
    } finally {
      setLegacyPaying(false);
    }
  };

  const serialGroup = getVerificationSerialGroup(
    allRecords.length ? allRecords : [record],
    record,
  );
  const showCertifiedGroupView =
    serialGroup.some(r => canShowVerificationCertifiedActions(r)) ||
    (canShowVerificationCertifiedActions(record) && serialGroup.length === 1);

  if (showCertifiedGroupView) {
    return (
      <InlineFormPanel
        id="verification-detail-panel"
        plain
        className="mb-6 inline-form-panel--wide inline-form-panel--certified-summary"
      >
        <div className="product-form-panel">
          <VerificationSerialGroupView
            record={record}
            allRecords={allRecords.length ? allRecords : [record]}
            onClose={onClose}
            onResubmitted={onRecordsChanged}
          />
        </div>
      </InlineFormPanel>
    );
  }

  return (
    <>
    <InlineFormPanel id="verification-detail-panel" className="mb-6 inline-form-panel--wide">
      <div className="product-form-panel">
        <ListViewBackBar onBack={onClose} />
        <div className="product-form-topbar">
          <div className="product-form-topbar-text">
            <h2>
              <Eye className="inline-icon" /> Verification details
            </h2>
            <p className="text-muted text-sm mt-1 mb-0">
              {record.customerName || '—'} · {record.serialNumber || 'no serial'}
            </p>
            <div className="verification-view-banner mt-2">
              <VerificationStatusBadge record={record} />
              {record.submittedAt && (
                <span className="text-muted text-xs">Submitted {formatDateTime(record.submittedAt)}</span>
              )}
              {record.applicationNumber?.trim() && (
                <span className="text-mono text-xs">App {record.applicationNumber.trim()}</span>
              )}
              {record.certificateNumber?.trim() && (
                <span className="text-mono text-xs">Cert {record.certificateNumber.trim()}</span>
              )}
            </div>
            {showLegacyPaymentBanner && legacyPaymentBreakdown && (
              <RvOutstandingWalletPaymentBanner
                breakdown={legacyPaymentBreakdown}
                canPay={isSuperAdmin}
                rcCenterName={rcCenterName}
                onPay={() => {
                  setLegacyPaymentError('');
                  setLegacyPaymentOpen(true);
                }}
                paying={legacyPaying}
              />
            )}
            {legacyPaymentError && (
              <p className="rc-form-topbar-error text-sm mt-2" role="alert">
                {legacyPaymentError}
              </p>
            )}
          </div>
        </div>

        <div className="verification-detail-body">
          <section className="verification-detail-section">
            <h3 className="verification-detail-section-title">Overview</h3>
            <div className="verification-detail-grid">
              <DetailField label="Record ID" value={<span className="text-mono text-sm">{record.id}</span>} />
              <DetailField
                label="Application no."
                value={
                  record.applicationNumber?.trim() ? (
                    <span className="text-mono">{record.applicationNumber.trim()}</span>
                  ) : (
                    '—'
                  )
                }
              />
              <DetailField label="RC centre" value={rcCenterName || '—'} />
              <DetailField label="VCT" value={verificationVctLabel(record)} />
              <DetailField label="Type" value={record.verificationType} />
              <DetailField label="Customer" value={record.customerName} />
              <DetailField label="Product" value={record.productName} />
              <DetailField label="Serial number" value={<span className="text-mono">{record.serialNumber}</span>} />
              <DetailField label="Cap / accuracy" value={formatVerificationCapAcc(record)} />
              <DetailField
                label="MPE"
                value={
                  record.maximumPermissibleError != null ? `${record.maximumPermissibleError} g` : undefined
                }
              />
              <DetailField
                label="Subject"
                value={record.verificationSubject === 'self' ? 'Self' : record.verificationSubject === 'customer' ? 'Customer' : '—'}
              />
              <DetailField label="Location" value={locationLabel(record.verificationLocation)} />
            </div>
          </section>

          <section className="verification-detail-section">
            <h3 className="verification-detail-section-title">Session</h3>
            <div className="verification-detail-grid">
              <DetailField label="Ambient temperature" value={record.ambientTemperature} />
              <DetailField label="Relative humidity" value={record.relativeHumidity} />
              <DetailField label="Seal ID" value={record.sealIdentificationNumber} />
              {record.verificationType === 'RV' && (
                <DetailField
                  label="Manufacturing year"
                  value={record.manufacturingYear != null ? String(record.manufacturingYear) : undefined}
                />
              )}
            </div>
          </section>

          <section className="verification-detail-section">
            <h3 className="verification-detail-section-title">Timeline</h3>
            <div className="verification-detail-grid">
              <DetailField label="Created" value={formatDateTime(record.createdAt)} />
              <DetailField label="Submitted" value={formatDateTime(record.submittedAt)} />
              <DetailField label="Approved" value={formatDateTime(record.approvedAt)} />
              <DetailField label="Certified" value={formatDateTime(record.certifiedAt)} />
            </div>
          </section>

          {(record.pipelineFailedPhase || record.pipelineFailureMessage) && (
            <section className="verification-detail-section">
              <h3 className="verification-detail-section-title">Pipeline</h3>
              <div className="verification-detail-grid">
                <DetailField
                  label="Failed phase"
                  value={
                    record.pipelineFailedPhase === 'submit'
                      ? 'Submit'
                      : record.pipelineFailedPhase === 'certification'
                        ? 'Certification'
                        : record.pipelineFailedPhase
                  }
                />
                <DetailField label="Failed at" value={formatDateTime(record.pipelineFailedAt)} />
                <DetailField label="Message" value={record.pipelineFailureMessage} />
              </div>
            </section>
          )}

          <section className="verification-detail-section">
            <h3 className="verification-detail-section-title">Attachments</h3>
            <div className="verification-detail-images">
              <DetailImage
                label="Serial number plate"
                url={record.stampingImageUrl}
                path={record.stampingImagePath}
                name={record.stampingImageName}
              />
              <DetailImage
                label="Instrument front"
                url={record.scaleImageUrl}
                path={record.scaleImagePath}
                name={record.scaleImageName}
              />
              {record.verificationType === 'RV' && (
                <DetailImage
                  label="Instrument rear"
                  url={record.instrumentRearImageUrl}
                  path={record.instrumentRearImagePath}
                  name={record.instrumentRearImageName}
                />
              )}
              <DetailImage
                label="Testing"
                url={record.standardWeightImageUrl}
                path={record.standardWeightImagePath}
                name={record.standardWeightImageName}
              />
              <DetailImage
                label="Verification seal"
                url={record.verificationSealImageUrl}
                path={record.verificationSealImagePath}
                name={record.verificationSealImageName}
              />
              <DetailImage
                label="Installation"
                url={record.installationImageUrl}
                path={record.installationImagePath}
                name={record.installationImageName}
              />
              {record.verificationType === 'RV' && (
                <>
                  <DetailImage
                    label="Old certificate"
                    url={record.oldVerificationCertificateUrl}
                    path={record.oldVerificationCertificatePath}
                    name={record.oldVerificationCertificateName}
                  />
                  <DetailImage
                    label="Old invoice"
                    url={record.oldInvoiceUrl}
                    path={record.oldInvoicePath}
                    name={record.oldInvoiceName}
                  />
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </InlineFormPanel>

    {legacyPaymentOpen && legacyPaymentBreakdown && record.rcId && (
      <RvWalletPaymentPanel
        breakdown={legacyPaymentBreakdown}
        rcId={record.rcId}
        recordIds={[record.id]}
        onPaid={handleLegacyPaymentComplete}
        onClose={() => setLegacyPaymentOpen(false)}
        walletOwnerLabel={rcCenterName?.trim() ? `${rcCenterName.trim()}'s` : "this RC centre's"}
        paymentContext="legacy-admin"
      />
    )}
    </>
  );
};
