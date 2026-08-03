import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  buildVerificationStatusFilterOptions,
  buildVerificationTypeFilterOptions,
  canDeleteVerification,
  canSubmitVerification,
  matchesVerificationTypeFilter,
  normalizeVerificationStatus,
  tallyVerificationTypeFilters,
} from '../../lib/verificationRequest';
import { matchesVerificationSearch } from '../../lib/verificationListSearch';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import {
  buildDuplicatePrimaryIdSet,
  buildSerialGroupMap,
  buildVerificationListDisplay,
  matchesVerificationListStatusFilter,
  tallyVerificationStatusFiltersCollapsed,
  verificationListCollapsedForCounts,
} from '../../lib/verificationListGrouping';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import {
  VerificationListFilters,
  type VerificationStatusFilter,
  type VerificationTypeFilter,
} from '../../components/VerificationListFilters';
import { TablePagination } from '../../components/TablePagination';
import { VerificationDetailPanel } from '../../components/VerificationDetailPanel';
import { VerificationListTable } from '../../components/VerificationListTable';
import { enrichVerificationListRecords } from '../../lib/verificationListPartyPhoto';
import { isRvWalletPaymentOutstanding } from '../../lib/rvPaymentAmount';
import {
  buildDevDeleteSubmittedMessage,
  canDevDeleteSubmittedVerification,
  collectSubmittedDeleteBatchForDisplay,
  devDeleteSubmittedVerification,
} from '../../lib/verificationDevDelete';
import {
  canMoveFailedSubmitToDraft,
  moveFailedSubmitVerificationToDraft,
} from '../../lib/verificationPipelineRepair';
import {
  isSiteCalibrationSubmittable,
  siteCalibrationSubmitBlockReason,
} from '../../lib/siteCalibrationProfileFields';
import {
  submitVerificationRecord,
  submitVerificationRecords,
  type VerificationSubmitOptions,
} from '../../lib/verificationSubmit';
import { formatZohoInvoiceGateError, isZohoInvoiceGateError } from '../../lib/zohoRvInvoice';
import { isZohoRvInvoicingEnabled } from '../../lib/zohoRvSubmit';
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../../types';

type RcListProfile = Pick<
  FirestoreUserDoc,
  'profilePhotoUrl' | 'profilePhotoPath' | 'contactPerson' | 'pincode' | 'zohoId'
>;

interface VerificationRow extends SiteCalibration {
  rcCenterName: string;
}

export const AdminVerificationList: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { appSettings } = useAppSettings();
  const isSuperAdmin = user?.role === 'super_admin';
  const [records, setRecords] = useState<VerificationRow[]>([]);
  const [customersById, setCustomersById] = useState<Map<string, Customer>>(() => new Map());
  const [rcUsersById, setRcUsersById] = useState<Map<string, RcListProfile>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<VerificationStatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<VerificationTypeFilter>('all');
  const [rcFilter, setRcFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [viewingRecord, setViewingRecord] = useState<VerificationRow | null>(null);
  const [lastViewedVerificationId, setLastViewedVerificationId] = useState<string | null>(null);
  const [rowHighlightFlashId, setRowHighlightFlashId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingToDraftId, setMovingToDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(() => new Set());
  const [listError, setListError] = useState('');
  const selectAllDraftsRef = useRef<HTMLInputElement | null>(null);

  const submitOptions = useMemo<VerificationSubmitOptions>(
    () => ({ zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings) }),
    [appSettings],
  );

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const [calibrationSnap, userSnap, customerSnap] = await Promise.all([
        getDocs(collection(db, 'siteCalibrations')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'customers')),
      ]);

      const rcByUid = new Map<string, string>();
      const rcProfiles = new Map<string, RcListProfile>();
      userSnap.docs.forEach(d => {
        const data = d.data() as FirestoreUserDoc;
        if (data.role === 'rc_admin') {
          rcByUid.set(d.id, data.companyName || data.username || '—');
          rcProfiles.set(d.id, {
            profilePhotoUrl: data.profilePhotoUrl,
            profilePhotoPath: data.profilePhotoPath,
            contactPerson: data.contactPerson,
            pincode: data.pincode,
            zohoId: data.zohoId,
          });
        }
      });

      const customerMap = new Map<string, Customer>();
      customerSnap.docs.forEach(d => {
        customerMap.set(d.id, { id: d.id, ...(d.data() as Omit<Customer, 'id'>) });
      });
      setCustomersById(customerMap);
      setRcUsersById(rcProfiles);

      const rows: VerificationRow[] = calibrationSnap.docs.map(d => {
        const data = d.data() as Omit<SiteCalibration, 'id'>;
        return {
          id: d.id,
          ...data,
          rcCenterName: (data.rcId && rcByUid.get(data.rcId)) || '—',
        };
      });

      rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setRecords(rows);
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load verifications.');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    if (!viewingRecord) return;
    const fresh = records.find(r => r.id === viewingRecord.id);
    if (fresh) {
      setViewingRecord(fresh);
    }
  }, [records, viewingRecord?.id]);

  const duplicatePrimaryIds = useMemo(() => buildDuplicatePrimaryIdSet(records), [records]);
  const serialGroups = useMemo(() => buildSerialGroupMap(records), [records]);

  const filteredRecords = useMemo(() => {
    const filtered = records.filter(record => {
      if (!matchesVerificationSearch(record, searchTerm, { rcCenterName: record.rcCenterName })) {
        return false;
      }
      if (
        !matchesVerificationListStatusFilter(
          record,
          statusFilter,
          records,
          duplicatePrimaryIds,
          serialGroups,
        )
      ) {
        return false;
      }
      if (!matchesVerificationTypeFilter(record, typeFilter)) {
        return false;
      }
      if (rcFilter !== 'all' && (record.rcId || '') !== rcFilter) {
        return false;
      }
      return true;
    });
    return buildVerificationListDisplay(filtered, records, statusFilter);
  }, [records, statusFilter, typeFilter, rcFilter, searchTerm, duplicatePrimaryIds, serialGroups]);

  const paginatedRecords = useMemo(
    () => paginateItems(filteredRecords, page, VERIFICATION_TABLE_PAGE_SIZE),
    [filteredRecords, page],
  );

  const paginatedRecordsWithPhotos = useMemo(
    () =>
      enrichVerificationListRecords(paginatedRecords, {
        rcUsersById,
        customersById,
      }),
    [paginatedRecords, rcUsersById, customersById],
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, rcFilter, searchTerm]);

  useEffect(() => {
    if (viewingRecord || !rowHighlightFlashId) return;

    const scrollTarget = document.querySelector(
      `[data-verification-row-id="${rowHighlightFlashId}"]`,
    );
    scrollTarget?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const timer = window.setTimeout(() => setRowHighlightFlashId(null), 1400);
    return () => clearTimeout(timer);
  }, [viewingRecord, rowHighlightFlashId]);

  const closeVerificationDetails = () => {
    const closingId = viewingRecord?.id ?? null;
    if (closingId) {
      setLastViewedVerificationId(closingId);
      setRowHighlightFlashId(closingId);
    }
    setViewingRecord(null);
  };

  const rcCenterNameByRcId = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of records) {
      const rcId = record.rcId?.trim() || 'unknown';
      if (!map.has(rcId)) {
        map.set(rcId, record.rcCenterName?.trim() || 'Unknown RC');
      }
    }
    return map;
  }, [records]);

  const listFilters = useMemo(
    () => ({
      statusFilter,
      typeFilter,
      rcFilter,
      searchTerm,
      searchExtras: (record: SiteCalibration) => ({
        rcCenterName: rcCenterNameByRcId.get(record.rcId?.trim() || 'unknown'),
      }),
    }),
    [statusFilter, typeFilter, rcFilter, searchTerm, rcCenterNameByRcId],
  );

  const counts = useMemo(
    () => tallyVerificationStatusFiltersCollapsed(records, listFilters),
    [records, listFilters],
  );
  const typeCounts = useMemo(
    () =>
      tallyVerificationTypeFilters(
        verificationListCollapsedForCounts(records, listFilters, 'type'),
      ),
    [records, listFilters],
  );
  const typeFilterOptions = buildVerificationTypeFilterOptions(typeCounts);

  const rcFilterOptions = useMemo(() => {
    const collapsed = verificationListCollapsedForCounts(records, listFilters, 'rc');
    const byRc = new Map<string, { label: string; count: number }>();
    for (const record of collapsed) {
      const rcId = record.rcId?.trim() || 'unknown';
      const label = rcCenterNameByRcId.get(rcId) || 'Unknown RC';
      const existing = byRc.get(rcId);
      if (existing) {
        existing.count += 1;
      } else {
        byRc.set(rcId, { label, count: 1 });
      }
    }

    const centres = [...byRc.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [
      { value: 'all', label: 'All RC', count: collapsed.length },
      ...centres,
    ];
  }, [records, listFilters, rcCenterNameByRcId]);

  const handleDelete = async (record: VerificationRow) => {
    const isDevSubmittedDelete = canDevDeleteSubmittedVerification(record, isSuperAdmin);
    if (!canDeleteVerification(record) && !isDevSubmittedDelete) return;

    const label = `${record.customerName} · ${record.serialNumber || 'no serial'}`;

    if (isDevSubmittedDelete) {
      const batch = collectSubmittedDeleteBatchForDisplay(record, records);
      const ok = await confirm({
        title: 'Delete submitted verification? (dev only)',
        message: buildDevDeleteSubmittedMessage(batch, record.rcCenterName || 'Regional Center'),
        messageFormat: 'preline',
        confirmLabel: 'Delete from Firebase',
        destructive: true,
      });
      if (!ok) return;

      setDeletingId(record.id);
      try {
        await devDeleteSubmittedVerification(record.id);
        if (viewingRecord?.id === record.id) {
          setViewingRecord(null);
        }
        if (lastViewedVerificationId === record.id) {
          setLastViewedVerificationId(null);
          setRowHighlightFlashId(null);
        }
        await fetchRecords();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to delete submitted verification.');
      } finally {
        setDeletingId(null);
      }
      return;
    }

    const ok = await confirm({
      title: 'Remove draft verification?',
      message: `Remove draft verification "${label}"?\n\nThis cannot be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(record.id);
    try {
      await deleteDoc(doc(db, 'siteCalibrations', record.id));
      if (viewingRecord?.id === record.id) {
        setViewingRecord(null);
      }
      if (lastViewedVerificationId === record.id) {
        setLastViewedVerificationId(null);
        setRowHighlightFlashId(null);
      }
      await fetchRecords();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove verification.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleMoveToDraft = async (record: VerificationRow) => {
    if (!canMoveFailedSubmitToDraft(record, isSuperAdmin)) return;

    const appNo = record.applicationNumber?.trim() || '—';
    const serial = record.serialNumber?.trim() || '—';
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

    setMovingToDraftId(record.id);
    setListError('');
    try {
      await moveFailedSubmitVerificationToDraft(record.id);
      if (viewingRecord?.id === record.id) {
        setViewingRecord(null);
      }
      await fetchRecords();
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to move verification to draft.');
    } finally {
      setMovingToDraftId(null);
    }
  };

  const recordSubmitOptions = useCallback(
    (record: SiteCalibration) => {
      const listedCustomer = record.customerId
        ? customersById.get(record.customerId) ?? null
        : null;
      const rcProfile = record.rcId ? rcUsersById.get(record.rcId) ?? null : null;
      return {
        customerPincode: listedCustomer?.pincode ?? null,
        rcPincode: rcProfile?.pincode ?? null,
        rcZohoId: rcProfile?.zohoId,
        zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings),
        requireUploadedImages: true,
      };
    },
    [customersById, rcUsersById, appSettings],
  );

  const draftSubmitMeta = useMemo(() => {
    const meta = new Map<string, { submittable: boolean; blockReason: string | null }>();
    for (const record of filteredRecords) {
      if (normalizeVerificationStatus(record) !== 'draft') continue;
      const blockReason = siteCalibrationSubmitBlockReason(record, recordSubmitOptions(record));
      meta.set(record.id, { submittable: !blockReason, blockReason });
    }
    return meta;
  }, [filteredRecords, recordSubmitOptions]);

  const selectableDraftIds = useMemo(
    () => [...draftSubmitMeta.entries()].filter(([, value]) => value.submittable).map(([id]) => id),
    [draftSubmitMeta],
  );

  const allSelectableDraftsSelected =
    selectableDraftIds.length > 0 && selectableDraftIds.every(id => selectedDraftIds.has(id));

  const someSelectableDraftsSelected =
    selectableDraftIds.some(id => selectedDraftIds.has(id)) && !allSelectableDraftsSelected;

  useEffect(() => {
    setSelectedDraftIds(new Set());
  }, [statusFilter, typeFilter, rcFilter, searchTerm]);

  useEffect(() => {
    if (selectAllDraftsRef.current) {
      selectAllDraftsRef.current.indeterminate = someSelectableDraftsSelected;
    }
  }, [someSelectableDraftsSelected, selectableDraftIds.length]);

  const toggleDraftSelection = (id: string, submittable: boolean) => {
    if (!submittable) return;
    setSelectedDraftIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllDrafts = () => {
    setSelectedDraftIds(prev => {
      if (allSelectableDraftsSelected) {
        const next = new Set(prev);
        selectableDraftIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...selectableDraftIds]);
    });
  };

  const handleSubmitRecord = async (record: SiteCalibration) => {
    if (!isSuperAdmin || !canSubmitVerification(record)) return;

    const validationError = siteCalibrationSubmitBlockReason(record, recordSubmitOptions(record));
    if (validationError) {
      setListError(validationError);
      return;
    }

    setSubmitting(true);
    setListError('');
    try {
      await submitVerificationRecord(
        {
          id: record.id,
          verificationType: record.verificationType,
        },
        db,
        submitOptions,
      );
      setSelectedDraftIds(prev => {
        if (!prev.has(record.id)) return prev;
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
      await fetchRecords();
    } catch (err: unknown) {
      setListError(
        isZohoInvoiceGateError(err)
          ? formatZohoInvoiceGateError(err)
          : err instanceof Error
            ? err.message
            : 'Failed to submit verification.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmitRecords = async () => {
    if (!isSuperAdmin) return;

    const selectedRecords = filteredRecords.filter(
      r => selectedDraftIds.has(r.id) && isSiteCalibrationSubmittable(r, recordSubmitOptions(r)),
    );

    if (selectedRecords.length === 0) {
      setListError('None of the selected drafts are ready to submit. Complete required fields and images first.');
      return;
    }

    setSubmitting(true);
    setListError('');
    try {
      await submitVerificationRecords(
        selectedRecords.map(record => ({
          id: record.id,
          verificationType: record.verificationType,
        })),
        db,
        submitOptions,
      );
      setSelectedDraftIds(new Set());
      await fetchRecords();
    } catch (err: unknown) {
      setListError(
        isZohoInvoiceGateError(err)
          ? formatZohoInvoiceGateError(err)
          : err instanceof Error
            ? err.message
            : 'Failed to submit selected verifications.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filterOptions = buildVerificationStatusFilterOptions(counts);
  const rowOffset = (page - 1) * VERIFICATION_TABLE_PAGE_SIZE;
  const walletPaymentDueRecordIds = useMemo(() => {
    return new Set(
      records
        .filter(record => isRvWalletPaymentOutstanding(record))
        .map(record => record.id),
    );
  }, [records]);
  return (
    <div className="fade-in page-content">
      {viewingRecord ? (
        <VerificationDetailPanel
          record={viewingRecord}
          allRecords={records}
          rcCenterName={viewingRecord.rcCenterName}
          rcContactPerson={
            viewingRecord.rcId
              ? rcUsersById.get(viewingRecord.rcId)?.contactPerson
              : null
          }
          onClose={closeVerificationDetails}
          onRecordsChanged={async () => {
            await fetchRecords();
          }}
        />
      ) : (
        <div className="verification-list-page fade-in">
          {listError && (
            <p className="verification-list-error rc-form-topbar-error text-sm" role="alert">
              {listError}
            </p>
          )}

          <VerificationListFilters
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchPlaceholder="Search verification…"
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            statusOptions={filterOptions}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            typeOptions={typeFilterOptions}
            rcFilter={rcFilter}
            onRcFilterChange={setRcFilter}
            rcOptions={rcFilterOptions}
            onRefresh={() => void fetchRecords()}
            refreshing={loading}
          />

          {isSuperAdmin && selectedDraftIds.size > 0 && (
            <div className="verification-bulk-bar">
              <span className="verification-bulk-bar-count">
                {selectedDraftIds.size} draft{selectedDraftIds.size !== 1 ? 's' : ''} selected
              </span>
              <button
                type="button"
                className="btn btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"
                onClick={() => void handleBulkSubmitRecords()}
                disabled={submitting}
              >
                {submitting ? (
                  <span className="spinner-inline" />
                ) : (
                  <>
                    <Send size={16} /> Submit for certification
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3"
                onClick={() => setSelectedDraftIds(new Set())}
                disabled={submitting}
              >
                Clear selection
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large" />
            </div>
          ) : (
            <>
              <TablePagination
                page={page}
                totalItems={filteredRecords.length}
                pageSize={VERIFICATION_TABLE_PAGE_SIZE}
                onPageChange={setPage}
                placement="top"
              />
              <VerificationListTable
                mode="admin"
                records={paginatedRecordsWithPhotos}
                rowOffset={rowOffset}
                formatDate={formatVerificationListDate}
                emptyMessage="No verifications match the current filters."
                onView={record => {
                  setLastViewedVerificationId(record.id);
                  setViewingRecord(record as VerificationRow);
                }}
                lastViewedRecordId={lastViewedVerificationId}
                flashRecordId={rowHighlightFlashId}
                walletPaymentDueRecordIds={walletPaymentDueRecordIds}
                adminDevDeleteEnabled={isSuperAdmin}
                adminMoveFailedSubmitEnabled={isSuperAdmin}
                onDelete={record => void handleDelete(record as VerificationRow)}
                onMoveToDraft={record => void handleMoveToDraft(record as VerificationRow)}
                onSubmit={
                  isSuperAdmin
                    ? record => void handleSubmitRecord(record)
                    : undefined
                }
                deletingId={deletingId}
                movingToDraftId={movingToDraftId}
                submitting={submitting}
                bulkSelect={
                  isSuperAdmin
                    ? {
                        selectedDraftIds,
                        draftSubmitMeta,
                        selectAllDraftsRef,
                        selectableDraftIds,
                        allSelectableDraftsSelected,
                        onToggleDraftSelection: toggleDraftSelection,
                        onToggleSelectAllDrafts: toggleSelectAllDrafts,
                      }
                    : undefined
                }
              />
              <TablePagination
                page={page}
                totalItems={filteredRecords.length}
                pageSize={VERIFICATION_TABLE_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
