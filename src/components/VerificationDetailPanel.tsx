import React from 'react';
import { Eye } from 'lucide-react';
import { InlineFormPanel } from './InlineFormPanel';
import { StorageImage } from './StorageImage';
import { VerificationSerialGroupView } from './VerificationSerialGroupView';
import { ListViewBackBar } from './ListViewBackBar';
import { RvLegacyWalletPaymentSection } from './RvLegacyWalletPaymentSection';
import { RvLegacyZohoInvoiceSection } from './RvLegacyZohoInvoiceSection';
import { VerificationZohoInvoiceSection } from './VerificationZohoInvoiceSection';
import { getVerificationSerialGroup } from '../lib/verificationResubmit';
import { VERIFICATION_LOCATION_OPTIONS } from '../lib/siteCalibrationProfileFields';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import {
  canShowVerificationCertifiedActions,
  formatVerificationCapAcc,
  verificationVctLabel,
} from '../lib/verificationRequest';
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

          <VerificationZohoInvoiceSection record={record} />

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

    </>
  );
};
