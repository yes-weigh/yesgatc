import React, { useEffect, useState, type RefObject } from 'react';
import {
  AlertCircle,
  Check,
  Clock,
  Download,
  FileInput,
  FileText,
  Pencil,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAppContext } from '../context/AppContext';
import {
  isZohoRvInvoicingEnabled,
  resolveZohoPushStatus,
  shouldShowZohoListBadge,
  zohoListBadgeText,
  type ZohoPushStatus,
} from '../lib/zohoRvSubmit';
import {
  canDeleteVerification,
  canDownloadVerificationCertificate,
  canSubmitVerification,
  canRcApproveVerifierVerification,
  getVerificationDisplayStatus,
  isVerificationEditable,
  normalizeVerificationStatus,
  sanitizeVerificationDisplayText,
  verificationFilterLabel,
  verificationVctLabel,
  firstValidVerificationTimestamp,
} from '../lib/verificationRequest';
import {
  canDevDeleteSubmittedVerification,
  verificationAdminDeleteLabel,
} from '../lib/verificationDevDelete';
import { canMoveFailedSubmitToDraft } from '../lib/verificationPipelineRepair';
import {
  formatProductGramValue,
  formatProductMaximumCapacity,
  formatProductMinimumCapacity,
} from '../lib/productCalculations';
import {
  formatVerificationListTime,
} from '../lib/verificationListFormat';
import {
  canShowSignedCertificatePdf,
  resolveCertificatePdfFileUrl,
  resolveCertificatePdfStoragePath,
} from '../lib/signedCertificatePdf';
import { verificationListPartyName } from '../lib/verificationPartyDetails';
import { prefetchPdfJs } from '../lib/pdfJs';
import { CertificatePdfShareViewer } from './CertificatePdfShareViewer';
import { SignedCertificateAvailabilityBadge } from './SignedCertificateAvailabilityBadge';
import type { Product, SiteCalibration, VerificationRequestStatus } from '../types';

export type VerificationListTableMode = 'rc' | 'admin';

export interface VerificationListTableRecord extends SiteCalibration {
  rcCenterName?: string;
  partyPhotoUrl?: string;
  partyPhotoPath?: string;
  rcContactPerson?: string;
  serialVersionCount?: number;
}

export interface VerificationListBulkSelectProps {
  selectedDraftIds: Set<string>;
  draftSubmitMeta: Map<string, { submittable: boolean; blockReason: string | null }>;
  selectAllDraftsRef: RefObject<HTMLInputElement | null>;
  selectableDraftIds: string[];
  allSelectableDraftsSelected: boolean;
  onToggleDraftSelection: (id: string, submittable: boolean) => void;
  onToggleSelectAllDrafts: () => void;
}

export interface VerificationListTableProps {
  mode: VerificationListTableMode;
  records: VerificationListTableRecord[];
  rowOffset: number;
  formatDate: (iso?: string) => string;
  emptyMessage: string;
  onView: (record: VerificationListTableRecord) => void;
  onEdit?: (record: VerificationListTableRecord) => void;
  onSubmit?: (record: VerificationListTableRecord) => void;
  onApprove?: (record: VerificationListTableRecord) => void;
  onDelete?: (record: VerificationListTableRecord) => void;
  /** Super Admin — move failed-at-submit back to draft. */
  onMoveToDraft?: (record: VerificationListTableRecord) => void;
  movingToDraftId?: string | null;
  deletingId?: string | null;
  submitting?: boolean;
  bulkSelect?: VerificationListBulkSelectProps;
  hideVctColumn?: boolean;
  lastViewedRecordId?: string | null;
  flashRecordId?: string | null;
  /** RV records submitted before wallet payment that still owe administrative fees. */
  walletPaymentDueRecordIds?: Set<string>;
  /** Super Admin + local dev — show delete for submitted OV/RV on admin list. */
  adminDevDeleteEnabled?: boolean;
  /** Super Admin — show move-to-draft for failed-at-submit rows. */
  adminMoveFailedSubmitEnabled?: boolean;
}

type VerificationListStatusTone =
  | VerificationRequestStatus
  | 'failed_submit'
  | 'failed_certification';

function stopRowClick(e: React.MouseEvent | React.KeyboardEvent) {
  e.stopPropagation();
}

function verificationListStatusLabel(record: SiteCalibration): string {
  const display = getVerificationDisplayStatus(record);
  if (display === 'certified') return 'Verified';
  return verificationFilterLabel(display);
}

function verificationListStatusTone(record: SiteCalibration): VerificationListStatusTone {
  return getVerificationDisplayStatus(record);
}

function verificationListDisplayDate(record: SiteCalibration): string {
  return firstValidVerificationTimestamp(record) ?? '';
}

function verificationListSpecFields(
  record: SiteCalibration,
  product: Product | undefined,
): { max: string; min: string; klass: string } {
  const max = formatProductMaximumCapacity({
    maximumCapacity: record.maximumCapacity ?? product?.maximumCapacity ?? 0,
    unitOfMeasurement: record.unitOfMeasurement ?? product?.unitOfMeasurement ?? 'kg',
  });
  const min = product
    ? formatProductMinimumCapacity(product)
    : formatProductGramValue(
        record.verificationScaleInterval != null
          ? record.verificationScaleInterval * 20
          : undefined,
      );
  const klass = product?.accuracyClass?.trim() || '—';
  return { max, min, klass };
}

function VerificationListMetric({
  label,
  value,
  title,
  mono,
  className,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`verification-list-card-metric${className ? ` ${className}` : ''}`}>
      <span className="verification-list-card-metric-label">{label}</span>
      <span
        className={`verification-list-card-metric-value${mono ? ' text-mono' : ''}`}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

function VerificationListTypeBadges({
  record,
  zohoListBadge,
}: {
  record: SiteCalibration;
  zohoListBadge: ZohoPushStatus | null;
}) {
  return (
    <span className="verification-list-card-type-row">
      {zohoListBadge && (
        <span
          className={`verification-list-zoho-badge verification-list-zoho-badge--${zohoListBadge}`}
          title={zohoListBadgeText(record, zohoListBadge)}
        >
          {zohoListBadgeText(record, zohoListBadge)}
        </span>
      )}
      <span
        className={`verification-list-card-type-badge role-badge ${
          record.verificationType === 'RV' ? 'badge-vct' : 'badge-rc'
        }`}
      >
        {record.verificationType === 'RV' ? 'RV' : 'OV'}
      </span>
    </span>
  );
}

function VerificationListStatusIcon({ tone }: { tone: VerificationListStatusTone }) {
  const size = 28;
  const stroke = 1.85;
  switch (tone) {
    case 'draft':
      return <FileText size={size} strokeWidth={stroke} aria-hidden />;
    case 'submitted':
      return <Send size={size} strokeWidth={stroke} aria-hidden />;
    case 'pending_rc':
      return <Clock size={size} strokeWidth={stroke} aria-hidden />;
    case 'failed_submit':
    case 'failed_certification':
      return <AlertCircle size={size} strokeWidth={stroke} aria-hidden />;
    case 'approved':
    case 'certified':
    default:
      return <ShieldCheck size={size} strokeWidth={stroke} aria-hidden />;
  }
}

export const VerificationListTable: React.FC<VerificationListTableProps> = ({
  mode,
  records,
  formatDate,
  emptyMessage,
  onView,
  onEdit,
  onSubmit,
  onApprove,
  onDelete,
  onMoveToDraft,
  movingToDraftId = null,
  deletingId = null,
  submitting = false,
  bulkSelect,
  hideVctColumn: _hideVctColumn = false,
  lastViewedRecordId = null,
  flashRecordId = null,
  walletPaymentDueRecordIds,
  adminDevDeleteEnabled = false,
  adminMoveFailedSubmitEnabled = false,
}) => {
  const { appSettings } = useAppSettings();
  const { products } = useAppContext();
  const bulk = bulkSelect;
  const showRcCentre = mode === 'admin';
  const zohoRvListEnabled = isZohoRvInvoicingEnabled(appSettings);
  const [pdfRecord, setPdfRecord] = useState<VerificationListTableRecord | null>(null);

  useEffect(() => {
    prefetchPdfJs();
  }, []);

  return (
    <div className="verification-list-cards-wrap">
      {bulk && bulk.selectableDraftIds.length > 0 && (
        <div className="verification-list-card-select-all">
          <label className="verification-device-check verification-device-check--header">
            <input
              ref={bulk.selectAllDraftsRef}
              type="checkbox"
              checked={bulk.allSelectableDraftsSelected}
              onChange={bulk.onToggleSelectAllDrafts}
              disabled={submitting}
              aria-label="Select all submittable drafts"
            />
            <span>Select all submittable drafts</span>
          </label>
        </div>
      )}

      {records.length === 0 ? (
        <p className="verification-list-cards-empty text-muted">{emptyMessage}</p>
      ) : (
        <div className="verification-list-cards">
          {records.map(record => {
            const editable = mode === 'rc' && isVerificationEditable(record);
            const draftMeta = bulk?.draftSubmitMeta.get(record.id);
            const isDraft = normalizeVerificationStatus(record) === 'draft';
            const submitBlockReason = draftMeta?.blockReason ?? null;
            const openDetails = () => onView(record);
            const detailTitle = editable ? 'Edit draft verification' : 'View verification details';
            const showEdit = mode === 'rc' && editable && onEdit;
            const showSubmit = canSubmitVerification(record) && Boolean(onSubmit);
            const showApprove = mode === 'rc' && Boolean(onApprove) && canRcApproveVerifierVerification(record);
            const showDownload =
              canDownloadVerificationCertificate(record) || canShowSignedCertificatePdf(record);
            const showDelete =
              onDelete
              && (canDeleteVerification(record)
                || (mode === 'admin'
                  && adminDevDeleteEnabled
                  && canDevDeleteSubmittedVerification(record, adminDevDeleteEnabled)));
            const showMoveToDraft =
              mode === 'admin'
              && adminMoveFailedSubmitEnabled
              && onMoveToDraft
              && canMoveFailedSubmitToDraft(record, adminMoveFailedSubmitEnabled);
            const deleteLabel = verificationAdminDeleteLabel(record, adminDevDeleteEnabled);
            const isLastViewed = Boolean(lastViewedRecordId) && lastViewedRecordId === record.id;
            const isFlash = Boolean(flashRecordId) && flashRecordId === record.id;
            const statusTone = verificationListStatusTone(record);
            const statusLabel = verificationListStatusLabel(record);
            const displayDate = formatDate(verificationListDisplayDate(record));
            const displayTime = formatVerificationListTime(verificationListDisplayDate(record));
            const displayDateTime =
              displayDate === '—'
                ? '—'
                : displayTime === '—'
                  ? displayDate
                  : `${displayDate}  ${displayTime}`;
            const certNo = sanitizeVerificationDisplayText(record.certificateNumber);
            const serial = record.serialNumber?.trim() || '—';
            const product = products.find(item => item.id === record.productId);
            const specs = verificationListSpecFields(record, product);
            const vctName = verificationVctLabel(record, {
              rcContactPerson: record.rcContactPerson,
            });
            const walletPaymentDue = walletPaymentDueRecordIds?.has(record.id) ?? false;
            const zohoPushStatus =
              record.verificationType === 'RV' && zohoRvListEnabled
                ? resolveZohoPushStatus(record)
                : null;
            const zohoListBadge = shouldShowZohoListBadge(zohoPushStatus) ? zohoPushStatus : null;

            return (
              <article
                key={record.id}
                data-verification-row-id={record.id}
                className={[
                  'verification-list-card',
                  `verification-list-card--${statusTone}`,
                  isLastViewed ? 'verification-list-card--last-viewed' : '',
                  isFlash ? 'verification-list-card--flash' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="verification-list-card-leading">
                  {bulk && isDraft && (
                    <label
                      className="verification-list-card-select verification-device-check"
                      title={submitBlockReason ?? 'Select for bulk submit'}
                      onClick={stopRowClick}
                    >
                      <input
                        type="checkbox"
                        checked={bulk.selectedDraftIds.has(record.id)}
                        onChange={() =>
                          bulk.onToggleDraftSelection(
                            record.id,
                            draftMeta?.submittable ?? false,
                          )
                        }
                        disabled={submitting || !draftMeta?.submittable}
                        aria-label={`Select ${record.customerName || 'verification'}`}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    className="verification-list-card-status"
                    onClick={openDetails}
                    title={detailTitle}
                    aria-label={`${statusLabel} — ${record.customerName || 'verification'}`}
                  >
                    <span className="verification-list-card-status-ring">
                      <VerificationListStatusIcon tone={statusTone} />
                    </span>
                    <span className="verification-list-card-status-label">{statusLabel}</span>
                  </button>
                </div>

                <button
                  type="button"
                  className="verification-list-card-body"
                  onClick={openDetails}
                  title={detailTitle}
                >
                  <div className="verification-list-card-header">
                    <div className="verification-list-card-header-main">
                      <h3 className="verification-list-card-title">
                        {verificationListPartyName(record, record.rcCenterName)}
                      </h3>
                      {walletPaymentDue && (
                        <span className="verification-list-wallet-due-badge">Payment due</span>
                      )}
                    </div>
                    <VerificationListTypeBadges record={record} zohoListBadge={zohoListBadge} />
                  </div>

                  <div className="verification-list-card-identity">
                    <span className="verification-list-card-cert text-mono" title={certNo}>
                      {certNo}
                    </span>
                    <SignedCertificateAvailabilityBadge record={record} />
                    {showRcCentre && (
                      <span
                        className="verification-list-card-rc"
                        title={record.rcCenterName || undefined}
                      >
                        {record.rcCenterName || '—'}
                      </span>
                    )}
                  </div>

                  <div className="verification-list-card-metrics">
                    <div className="verification-list-card-metrics-row verification-list-card-metrics-row--specs">
                      <VerificationListMetric label="Max" value={specs.max} title={specs.max} />
                      <VerificationListMetric label="Min" value={specs.min} title={specs.min} />
                      <VerificationListMetric label="Class" value={specs.klass} title={specs.klass} />
                      <VerificationListMetric
                        label="Serial no."
                        value={
                          <>
                            {serial}
                            {record.serialVersionCount != null && record.serialVersionCount > 1 && (
                              <span className="verification-list-version-badge verification-list-version-badge--inline">
                                {' '}
                                ({record.serialVersionCount})
                              </span>
                            )}
                          </>
                        }
                        title={serial}
                        mono
                      />
                    </div>
                    <div className="verification-list-card-metrics-row verification-list-card-metrics-row--meta">
                      <VerificationListMetric
                        label="Date"
                        value={displayDateTime}
                        title={displayDateTime}
                        className="verification-list-card-metric--datetime"
                      />
                      <VerificationListMetric
                        label="VCT"
                        value={vctName}
                        title={vctName}
                        className="verification-list-card-metric--vct"
                      />
                    </div>
                  </div>
                </button>

                <div
                  className="verification-list-card-actions"
                  onClick={stopRowClick}
                  onKeyDown={stopRowClick}
                  role="presentation"
                >
                  {showDownload && (
                    <button
                      type="button"
                      className="verification-list-card-download"
                      title={canShowSignedCertificatePdf(record) ? 'View signed certificate PDF' : 'View certificate PDF'}
                      aria-label={`View certificate for ${record.customerName}`}
                      onClick={() => setPdfRecord(record)}
                    >
                      <span className="verification-list-card-download-ring">
                        <Download size={22} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="verification-list-card-download-label">Download</span>
                    </button>
                  )}
                  {(showEdit || showSubmit || showApprove || showDelete || showMoveToDraft) && (
                    <div className="verification-list-card-draft-actions">
                      {showEdit && (
                        <button
                          type="button"
                          className="verification-list-card-icon-btn"
                          onClick={() => onEdit!(record)}
                          title="Edit draft"
                          aria-label={`Edit draft verification for ${record.customerName}`}
                        >
                          <Pencil size={18} />
                        </button>
                      )}
                      {showSubmit && (
                        <button
                          type="button"
                          className="verification-list-card-icon-btn verification-list-card-icon-btn--submit"
                          onClick={() => void onSubmit!(record)}
                          disabled={submitting || Boolean(submitBlockReason)}
                          title={submitBlockReason ?? 'Submit for certification'}
                          aria-label={`Submit verification for ${record.customerName}`}
                        >
                          <Send size={18} />
                        </button>
                      )}
                      {showApprove && (
                        <button
                          type="button"
                          className="verification-list-card-icon-btn verification-list-card-icon-btn--approve"
                          onClick={() => void onApprove!(record)}
                          disabled={submitting}
                          title="Approve verifier work"
                          aria-label={`Approve verifier work for ${record.customerName}`}
                        >
                          <Check size={18} />
                        </button>
                      )}
                      {showMoveToDraft && (
                        <button
                          type="button"
                          className="verification-list-card-icon-btn"
                          onClick={() => void onMoveToDraft!(record)}
                          disabled={movingToDraftId === record.id}
                          title="Move to draft"
                          aria-label={`Move failed submit to draft for ${record.customerName}`}
                        >
                          <FileInput size={18} />
                        </button>
                      )}
                      {showDelete && (
                        <button
                          type="button"
                          className="verification-list-card-icon-btn verification-list-card-icon-btn--delete"
                          onClick={() => void onDelete!(record)}
                          disabled={deletingId === record.id}
                          title={deleteLabel}
                          aria-label={`${deleteLabel} for ${record.customerName}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <CertificatePdfShareViewer
        open={Boolean(pdfRecord)}
        record={pdfRecord}
        url={pdfRecord ? resolveCertificatePdfFileUrl(pdfRecord) : null}
        storagePath={pdfRecord ? resolveCertificatePdfStoragePath(pdfRecord) : null}
        heading={
          pdfRecord && canShowSignedCertificatePdf(pdfRecord) ? 'Signed certificate' : undefined
        }
        onClose={() => setPdfRecord(null)}
      />
    </div>
  );
};
