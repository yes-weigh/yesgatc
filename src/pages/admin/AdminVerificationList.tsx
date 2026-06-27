import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  buildVerificationStatusFilterOptions,
  buildVerificationTypeFilterOptions,
  canDeleteVerification,
  matchesVerificationTypeFilter,
  tallyVerificationTypeFilters,
} from '../../lib/verificationRequest';
import { matchesVerificationSearch } from '../../lib/verificationListSearch';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import {
  buildDuplicatePrimaryIdSet,
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
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../../types';

interface VerificationRow extends SiteCalibration {
  rcCenterName: string;
}

export const AdminVerificationList: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const isSuperAdmin = user?.role === 'super_admin';
  const [records, setRecords] = useState<VerificationRow[]>([]);
  const [customersById, setCustomersById] = useState<Map<string, Customer>>(() => new Map());
  const [rcUsersById, setRcUsersById] = useState<
    Map<string, Pick<FirestoreUserDoc, 'profilePhotoUrl' | 'profilePhotoPath'>>
  >(() => new Map());
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
  const [listError, setListError] = useState('');

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
      const rcProfiles = new Map<string, Pick<FirestoreUserDoc, 'profilePhotoUrl' | 'profilePhotoPath'>>();
      userSnap.docs.forEach(d => {
        const data = d.data() as FirestoreUserDoc;
        if (data.role === 'rc_admin') {
          rcByUid.set(d.id, data.companyName || data.username || '—');
          rcProfiles.set(d.id, {
            profilePhotoUrl: data.profilePhotoUrl,
            profilePhotoPath: data.profilePhotoPath,
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

  const filteredRecords = useMemo(() => {
    const filtered = records.filter(record => {
      if (!matchesVerificationSearch(record, searchTerm, { rcCenterName: record.rcCenterName })) {
        return false;
      }
      if (!matchesVerificationListStatusFilter(record, statusFilter, records, duplicatePrimaryIds)) {
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
  }, [records, statusFilter, typeFilter, rcFilter, searchTerm, duplicatePrimaryIds]);

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
                onDelete={record => void handleDelete(record as VerificationRow)}
                deletingId={deletingId}
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
