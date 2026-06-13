import React from 'react';
import { Eye } from 'lucide-react';
import { InlineFormPanel } from './InlineFormPanel';
import { StorageImage } from './StorageImage';
import { VerificationSerialGroupView } from './VerificationSerialGroupView';
import { ListViewBackBar } from './ListViewBackBar';
import { RvLegacyWalletPaymentSection } from './RvLegacyWalletPaymentSection';
import { RvLegacyZohoInvoiceSection } from './RvLegacyZohoInvoiceSection';
import { RvLegacyZohoSettlementSection } from './RvLegacyZohoSettlementSection';
import { RvSubmitTestRevertSection } from './RvSubmitTestRevertSection';
import { verificationZohoInvoiceNumber } from '../lib/zohoRvSubmit';
import { VerificationZohoInvoiceSection } from './VerificationZohoInvoiceSection';
import { getVerificationSerialGroup } from '../lib/verificationResubmit';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import {
  VerificationDetailSpecRow,
  VerificationDetailSpecSection,
  VerificationDetailSpecs,
} from './VerificationDetailSpecs';
import { canShowVerificationCertifiedActions, verificationCertificateNumber } from '../lib/verificationRequest';
import type { SiteCalibration } from '../types';

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
            rcCenterName={rcCenterName}
            onClose={onClose}
            onResubmitted={onRecordsChanged}
            onPaymentRecorded={onRecordsChanged}
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
            {rcCenterName?.trim() && (
              <p className="verification-detail-rc-centre text-sm mt-1 mb-0">
                {rcCenterName.trim()}
              </p>
            )}
            <div className="verification-view-banner mt-2">
              <VerificationStatusBadge record={record} />
              {record.submittedAt && (
                <span className="text-muted text-xs">Submitted {formatDateTime(record.submittedAt)}</span>
              )}
              {record.applicationNumber?.trim() && (
                <span className="text-mono text-xs">App {record.applicationNumber.trim()}</span>
              )}
              {verificationZohoInvoiceNumber(record) && (
                <span className="text-mono text-xs">
                  Zoho {verificationZohoInvoiceNumber(record)}
                </span>
              )}
              {verificationCertificateNumber(record) && (
                <span className="text-mono text-xs">Cert {verificationCertificateNumber(record)}</span>
              )}
            </div>
            <RvLegacyWalletPaymentSection
              record={record}
              rcCenterName={rcCenterName}
              onPaymentRecorded={onRecordsChanged}
            />
            <RvLegacyZohoInvoiceSection
              record={record}
              rcCenterName={rcCenterName}
              onInvoicePushed={onRecordsChanged}
            />
            <RvLegacyZohoSettlementSection
              record={record}
              onSettled={onRecordsChanged}
            />
            <RvSubmitTestRevertSection
              record={record}
              allRecords={allRecords}
              rcCenterName={rcCenterName}
              onReverted={async () => {
                await onRecordsChanged?.();
                onClose();
              }}
              className="mt-3"
            />
          </div>
        </div>

        <div className="verification-detail-body">
          <VerificationDetailSpecs record={record} omitChromeFields includeTimeline />

          <VerificationZohoInvoiceSection record={record} />

          <VerificationDetailSpecSection title="Record">
            <VerificationDetailSpecRow
              label="Record ID"
              value={<span className="text-mono text-sm">{record.id}</span>}
              mono
              full
            />
            <VerificationDetailSpecRow label="Created" value={formatDateTime(record.createdAt)} />
            <VerificationDetailSpecRow label="Approved" value={formatDateTime(record.approvedAt)} />
          </VerificationDetailSpecSection>

          {(record.pipelineFailedPhase || record.pipelineFailureMessage) && (
            <VerificationDetailSpecSection title="Pipeline">
              <VerificationDetailSpecRow
                label="Failed phase"
                value={
                  record.pipelineFailedPhase === 'submit'
                    ? 'Submit'
                    : record.pipelineFailedPhase === 'certification'
                      ? 'Certification'
                      : record.pipelineFailedPhase
                }
              />
              <VerificationDetailSpecRow label="Failed at" value={formatDateTime(record.pipelineFailedAt)} />
              <VerificationDetailSpecRow
                label="Message"
                value={record.pipelineFailureMessage}
                full
              />
            </VerificationDetailSpecSection>
          )}

          {(record.performerSelfieIdImageUrl?.trim()
            || record.performerSelfieIdImagePath?.trim()
            || record.performerIdAadhaarImageUrl?.trim()
            || record.performerIdAadhaarImagePath?.trim()) && (
            <section className="verification-detail-section">
              <h3 className="verification-detail-section-title">Verifier identity</h3>
              <div className="verification-detail-images">
                <DetailImage
                  label="Selfie wearing GATC ID"
                  url={record.performerSelfieIdImageUrl}
                  path={record.performerSelfieIdImagePath}
                  name={record.performerSelfieIdImageName}
                />
                <DetailImage
                  label="Aadhaar and GATC ID"
                  url={record.performerIdAadhaarImageUrl}
                  path={record.performerIdAadhaarImagePath}
                  name={record.performerIdAadhaarImageName}
                />
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
              <DetailImage
                label="Instrument rear"
                url={record.instrumentRearImageUrl}
                path={record.instrumentRearImagePath}
                name={record.instrumentRearImageName}
              />
              <DetailImage
                label="F2 test weight"
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
              {(record.installationImageUrl?.trim() || record.installationImagePath?.trim()) && (
                <DetailImage
                  label="Installation (legacy)"
                  url={record.installationImageUrl}
                  path={record.installationImagePath}
                  name={record.installationImageName}
                />
              )}
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

    </>
  );
};
