import React, { type RefObject } from 'react';
import {
  AlertCircle,
  Download,
  FileText,
  Pencil,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAppSettings } from '../hooks/useAppSettings';
import { isRvWalletPaymentRequired } from '../lib/appSettings';
import { formatRcFeeAmount } from '../lib/rcProfileFields';
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
  getVerificationDisplayStatus,
  isVerificationEditable,
  normalizeVerificationStatus,
  verificationFilterLabel,
  verificationVctLabel,
} from '../lib/verificationRequest';
import type { SiteCalibration, VerificationRequestStatus } from '../types';

export type VerificationListTableMode = 'rc' | 'admin';

export interface VerificationListTableRecord extends SiteCalibration {
  rcCenterName?: string;
  partyPhotoUrl?: string;
  partyPhotoPath?: string;
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
  onDelete?: (record: VerificationListTableRecord) => void;
  deletingId?: string | null;
  submitting?: boolean;
  bulkSelect?: VerificationListBulkSelectProps;
  hideVctColumn?: boolean;
  lastViewedRecordId?: string | null;
  flashRecordId?: string | null;
  /** RV records submitted before wallet payment that still owe administrative fees. */
  walletPaymentDueRecordIds?: Set<string>;
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
  return record.certifiedAt || record.approvedAt || record.submittedAt || record.createdAt;
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
      <span
        className={`verification-list-card-type-badge role-badge ${
          record.verificationType === 'RV' ? 'badge-vct' : 'badge-rc'
        }`}
      >
        {record.verificationType === 'RV' ? 'RV' : 'OV'}
      </span>
      {zohoListBadge && (
        <span
          className={`verification-list-zoho-badge verification-list-zoho-badge--${zohoListBadge}`}
          title={zohoListBadgeText(record, zohoListBadge)}
        >
          {zohoListBadgeText(record, zohoListBadge)}
        </span>
      )}
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
  onDelete,
  deletingId = null,
  submitting = false,
  bulkSelect,
  hideVctColumn = false,
  lastViewedRecordId = null,
  flashRecordId = null,
  walletPaymentDueRecordIds,
}) => {
  const { appSettings } = useAppSettings();
  const showBulkSelect = mode === 'rc' && bulkSelect;
  const showRcCentre = mode === 'admin';
  const showVctColumn = !hideVctColumn;
  const rvWalletListEnabled = isRvWalletPaymentRequired('RV', appSettings);
  const zohoRvListEnabled = isZohoRvInvoicingEnabled(appSettings);

  return (
    <div className="verification-list-cards-wrap">
      {showBulkSelect && bulkSelect.selectableDraftIds.length > 0 && (
        <div className="verification-list-card-select-all">
          <label className="verification-device-check verification-device-check--header">
            <input
              ref={bulkSelect.selectAllDraftsRef}
              type="checkbox"
              checked={bulkSelect.allSelectableDraftsSelected}
              onChange={bulkSelect.onToggleSelectAllDrafts}
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
            const draftMeta = bulkSelect?.draftSubmitMeta.get(record.id);
            const isDraft = normalizeVerificationStatus(record) === 'draft';
            const submitBlockReason = draftMeta?.blockReason ?? null;
            const openDetails = () => onView(record);
            const detailTitle = editable ? 'Edit draft verification' : 'View verification details';
            const showEdit = mode === 'rc' && editable && onEdit;
            const showSubmit = mode === 'rc' && canSubmitVerification(record) && onSubmit;
            const showDownload = canDownloadVerificationCertificate(record);
            const showDelete = canDeleteVerification(record) && onDelete;
            const isLastViewed = Boolean(lastViewedRecordId) && lastViewedRecordId === record.id;
            const isFlash = Boolean(flashRecordId) && flashRecordId === record.id;
            const statusTone = verificationListStatusTone(record);
            const statusLabel = verificationListStatusLabel(record);
            const displayDate = formatDate(verificationListDisplayDate(record));
            const certNo = record.certificateNumber?.trim() || '—';
            const serial = record.serialNumber?.trim() || '—';
            const walletPaymentDue = walletPaymentDueRecordIds?.has(record.id) ?? false;
            const zohoPushStatus =
              record.verificationType === 'RV' && zohoRvListEnabled
                ? resolveZohoPushStatus(record)
                : null;
            const zohoListBadge = shouldShowZohoListBadge(zohoPushStatus) ? zohoPushStatus : null;
            const walletDeductedAmount =
              record.verificationType === 'RV'
              && rvWalletListEnabled
              && record.rvPaymentStatus === 'paid'
              && record.rvPaymentAmount != null
              && Number.isFinite(record.rvPaymentAmount)
                ? record.rvPaymentAmount
                : null;

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
                  {showBulkSelect && isDraft && (
                    <label
                      className="verification-list-card-select verification-device-check"
                      title={submitBlockReason ?? 'Select for bulk submit'}
                      onClick={stopRowClick}
                    >
                      <input
                        type="checkbox"
                        checked={bulkSelect.selectedDraftIds.has(record.id)}
                        onChange={() =>
                          bulkSelect.onToggleDraftSelection(
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
                  <h3 className="verification-list-card-title">{record.customerName || '—'}</h3>
                  {walletPaymentDue && (
                    <span className="verification-list-wallet-due-badge">Payment due</span>
                  )}
                  <p className="verification-list-card-cert text-mono" title={certNo}>
                    {certNo}
                  </p>
                  <div className="verification-list-card-metrics">
                    <div className="verification-list-card-metric verification-list-card-metric--serial">
                      <span className="verification-list-card-metric-label">Serial No.</span>
                      <span
                        className="verification-list-card-metric-value text-mono"
                        title={serial}
                      >
                        {serial}
                        {record.serialVersionCount != null && record.serialVersionCount > 1 && (
                          <span className="verification-list-version-badge verification-list-version-badge--inline">
                            {' '}
                            ({record.serialVersionCount})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="verification-list-card-metric verification-list-card-metric--date">
                      <span className="verification-list-card-metric-label">Date</span>
                      <span className="verification-list-card-metric-value">{displayDate}</span>
                    </div>
                    {walletDeductedAmount != null && (
                      <div className="verification-list-card-metric verification-list-card-metric--wallet">
                        <span className="verification-list-card-metric-label">Wallet</span>
                        <span className="verification-list-card-metric-value">
                          {formatRcFeeAmount(walletDeductedAmount)}
                        </span>
                      </div>
                    )}
                    {showRcCentre && (
                      <div className="verification-list-card-metric verification-list-card-metric--rc">
                        <span className="verification-list-card-metric-label">RC centre</span>
                        <span
                          className="verification-list-card-metric-value"
                          title={record.rcCenterName || undefined}
                        >
                          {record.rcCenterName || '—'}
                        </span>
                      </div>
                    )}
                    {showVctColumn && (
                      <div className="verification-list-card-metric verification-list-card-metric--vct">
                        <div className="verification-list-card-metric-stack verification-list-card-metric-stack--vct">
                          <span className="verification-list-card-metric-label">VCT</span>
                          <span className="verification-list-card-metric-value verification-list-card-metric-text">
                            {verificationVctLabel(record)}
                          </span>
                        </div>
                        <div className="verification-list-card-metric-stack verification-list-card-metric-stack--type">
                          <span className="verification-list-card-metric-label verification-list-card-metric-label--type">
                            Type
                          </span>
                          <VerificationListTypeBadges record={record} zohoListBadge={zohoListBadge} />
                        </div>
                      </div>
                    )}
                    {!showVctColumn && (
                      <div className="verification-list-card-metric verification-list-card-metric--type">
                        <span className="verification-list-card-metric-label">Type</span>
                        <VerificationListTypeBadges record={record} zohoListBadge={zohoListBadge} />
                      </div>
                    )}
                  </div>
                </button>

                <div
                  className="verification-list-card-actions"
                  onClick={stopRowClick}
                  onKeyDown={stopRowClick}
                  role="presentation"
                >
                  {showDownload && (
                    <a
                      href={record.certificatePdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="verification-list-card-download"
                      title="Download certificate PDF"
                      aria-label={`Download certificate for ${record.customerName}`}
                    >
                      <span className="verification-list-card-download-ring">
                        <Download size={22} strokeWidth={2} aria-hidden />
                      </span>
                      <span className="verification-list-card-download-label">Download</span>
                    </a>
                  )}
                  {(showEdit || showSubmit || showDelete) && (
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
                      {showDelete && (
                        <button
                          type="button"
                          className="verification-list-card-icon-btn verification-list-card-icon-btn--delete"
                          onClick={() => void onDelete!(record)}
                          disabled={deletingId === record.id}
                          title="Remove draft"
                          aria-label={`Remove draft verification for ${record.customerName}`}
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
    </div>
  );
};
