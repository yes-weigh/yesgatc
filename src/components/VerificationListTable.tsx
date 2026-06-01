import React, { type RefObject } from 'react';
import { Download, Pencil, Send, Trash2 } from 'lucide-react';
import {
  canDeleteVerification,
  canDownloadVerificationCertificate,
  canSubmitVerification,
  formatVerificationCapAcc,
  isVerificationEditable,
  normalizeVerificationStatus,
  verificationVctLabel,
} from '../lib/verificationRequest';
import { tableEditCellProps } from '../lib/tableEditCell';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import type { SiteCalibration } from '../types';

export type VerificationListTableMode = 'rc' | 'admin';

export interface VerificationListTableRecord extends SiteCalibration {
  rcCenterName?: string;
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
}

function typeBadgeClass(type: SiteCalibration['verificationType']): string {
  return type === 'OV' ? 'site-calibration-type-ov' : 'site-calibration-type-rv';
}

function StackedHeader({ top, bottom }: { top: string; bottom: string }) {
  return (
    <span className="verification-table-stacked-header">
      <span>{top}</span>
      <span>{bottom}</span>
    </span>
  );
}

function stopRowClick(e: React.MouseEvent | React.KeyboardEvent) {
  e.stopPropagation();
}

export const VerificationListTable: React.FC<VerificationListTableProps> = ({
  mode,
  records,
  rowOffset,
  formatDate,
  emptyMessage,
  onView,
  onEdit,
  onSubmit,
  onDelete,
  deletingId = null,
  submitting = false,
  bulkSelect,
}) => {
  const showBulkSelect = mode === 'rc' && bulkSelect;
  const showRcCentre = mode === 'admin';
  const colSpan = 8 + (showBulkSelect ? 1 : 0) + (showRcCentre ? 1 : 0);

  return (
    <div className="table-scroll-wrap">
      <table className="data-table data-table--site-calibration data-table--mobile-cards">
        <thead>
          <tr>
            {showBulkSelect && (
              <th className="verification-table-col-select">
                {bulkSelect.selectableDraftIds.length > 0 ? (
                  <label
                    className="verification-device-check verification-device-check--header"
                    title="Select all submittable drafts"
                  >
                    <input
                      ref={bulkSelect.selectAllDraftsRef}
                      type="checkbox"
                      checked={bulkSelect.allSelectableDraftsSelected}
                      onChange={bulkSelect.onToggleSelectAllDrafts}
                      disabled={submitting}
                      aria-label="Select all submittable drafts"
                    />
                    <span className="sr-only">Select all</span>
                  </label>
                ) : null}
              </th>
            )}
            <th className="site-calibration-col-serial">#</th>
            <th>Date</th>
            {showRcCentre && <th>RC centre</th>}
            <th>VCT</th>
            <th>Belongs to</th>
            <th className="site-calibration-col-type-cap">
              <StackedHeader top="Cap/Acc" bottom="Type" />
            </th>
            <th className="site-calibration-col-ids">
              <StackedHeader top="Serial" bottom="Cert" />
            </th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => {
            const editable = mode === 'rc' && isVerificationEditable(record);
            const draftMeta = bulkSelect?.draftSubmitMeta.get(record.id);
            const isDraft = normalizeVerificationStatus(record) === 'draft';
            const submitBlockReason = draftMeta?.blockReason ?? null;
            const openDetails = () => onView(record);
            const detailCell = tableEditCellProps(
              openDetails,
              editable ? 'Edit draft verification' : 'View verification details',
            );
            const deletable = canDeleteVerification(record);
            const showEdit = mode === 'rc' && editable && onEdit;
            const showSubmit = mode === 'rc' && canSubmitVerification(record) && onSubmit;
            const showDownload = canDownloadVerificationCertificate(record);
            const showDelete = deletable && onDelete;
            const hasActions = showEdit || showSubmit || showDownload || showDelete;

            return (
              <tr key={record.id} className="table-mobile-row table-mobile-row--actions">
                {showBulkSelect && (
                  <td className="verification-table-col-select table-mobile-col-hide">
                    {isDraft ? (
                      <label
                        className="verification-device-check"
                        title={submitBlockReason ?? 'Select for bulk submit'}
                        onClick={stopRowClick}
                      >
                        <input
                          type="checkbox"
                          checked={bulkSelect.selectedDraftIds.has(record.id)}
                          onChange={() =>
                            bulkSelect.onToggleDraftSelection(record.id, draftMeta?.submittable ?? false)
                          }
                          disabled={submitting || !draftMeta?.submittable}
                          aria-label={`Select ${record.customerName || 'verification'}`}
                        />
                      </label>
                    ) : null}
                  </td>
                )}
                <td className="site-calibration-col-serial text-muted text-sm table-mobile-col-hide">
                  {rowOffset + index + 1}
                </td>
                <td {...detailCell} className="text-sm table-mobile-col-hide table-col-editable">
                  {formatDate(record.createdAt)}
                </td>
                {showRcCentre && (
                  <td {...detailCell} className="text-sm table-mobile-col-hide table-col-editable">
                    {record.rcCenterName || '—'}
                  </td>
                )}
                <td {...detailCell} className="text-sm table-mobile-col-hide table-col-editable">
                  {verificationVctLabel(record)}
                </td>
                <td {...detailCell} className="font-medium table-mobile-col-primary table-col-editable">
                  <span className="table-mobile-primary-text">{record.customerName || '—'}</span>
                  <div className="table-mobile-summary">
                    <span className="table-mobile-summary-badges">
                      <VerificationStatusBadge record={record} />
                      <span className={`status-badge ${typeBadgeClass(record.verificationType)}`}>
                        {record.verificationType}
                      </span>
                    </span>
                    {showRcCentre && record.rcCenterName && (
                      <span>{record.rcCenterName}</span>
                    )}
                    <span className="site-calibration-cap-acc-inline">
                      {formatVerificationCapAcc(record)} · {record.serialNumber || '—'}
                    </span>
                    <span className="table-mobile-summary-meta">
                      VCT {verificationVctLabel(record)} · {formatDate(record.createdAt)}
                    </span>
                    <span className="table-mobile-summary-meta">
                      Cert {record.certificateNumber?.trim() || '—'}
                    </span>
                  </div>
                </td>
                <td
                  {...detailCell}
                  className="text-sm table-mobile-col-hide table-col-editable site-calibration-col-type-cap"
                >
                  <div className="verification-table-stacked">
                    <span className="verification-table-stacked-primary">
                      {formatVerificationCapAcc(record)}
                    </span>
                    <span className={`status-badge ${typeBadgeClass(record.verificationType)}`}>
                      {record.verificationType}
                    </span>
                  </div>
                </td>
                <td
                  {...detailCell}
                  className="text-sm table-mobile-col-hide table-col-editable site-calibration-col-ids"
                >
                  <div className="verification-table-stacked">
                    <span className="text-mono verification-table-stacked-primary">
                      {record.serialNumber || '—'}
                    </span>
                    <span className="text-mono verification-table-stacked-secondary">
                      {record.certificateNumber?.trim() || '—'}
                    </span>
                  </div>
                </td>
                <td
                  {...detailCell}
                  className="verification-status-actions-cell table-mobile-col-actions table-col-editable"
                >
                  <div className="verification-status-actions">
                    <VerificationStatusBadge record={record} />
                    {hasActions && (
                      <div
                        className="verification-row-actions"
                        onClick={stopRowClick}
                        onKeyDown={stopRowClick}
                        role="presentation"
                      >
                        {showEdit && (
                          <button
                            type="button"
                            className="btn-icon"
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
                            className="btn-icon text-blue"
                            onClick={() => void onSubmit!(record)}
                            disabled={submitting || Boolean(submitBlockReason)}
                            title={submitBlockReason ?? 'Submit for certification'}
                            aria-label={`Submit verification for ${record.customerName}`}
                          >
                            <Send size={18} />
                          </button>
                        )}
                        {showDownload && (
                          <a
                            href={record.certificatePdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-icon text-green"
                            title="Download certificate PDF"
                            aria-label={`Download certificate for ${record.customerName}`}
                          >
                            <Download size={18} />
                          </a>
                        )}
                        {showDelete && (
                          <button
                            type="button"
                            className="btn-icon text-red"
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
                </td>
              </tr>
            );
          })}
          {records.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="text-center py-10 text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
