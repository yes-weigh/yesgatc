import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirm } from '../../context/ConfirmContext';
import {
  buildVerificationStatusFilterOptions,
  canDeleteVerification,
  matchesVerificationStatusFilter,
  tallyVerificationStatusFilters,
} from '../../lib/verificationRequest';
import { matchesVerificationSearch } from '../../lib/verificationListSearch';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import {
  VerificationListFilters,
  type VerificationStatusFilter,
} from '../../components/VerificationListFilters';
import { TablePagination } from '../../components/TablePagination';
import { VerificationDetailPanel } from '../../components/VerificationDetailPanel';
import { VerificationListTable } from '../../components/VerificationListTable';
import type { FirestoreUserDoc, SiteCalibration } from '../../types';

interface VerificationRow extends SiteCalibration {
  rcCenterName: string;
}

export const AdminVerificationList: React.FC = () => {
  const confirm = useConfirm();
  const [records, setRecords] = useState<VerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<VerificationStatusFilter>('submitted');
  const [rcFilter, setRcFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [viewingRecord, setViewingRecord] = useState<VerificationRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listError, setListError] = useState('');

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const [calibrationSnap, userSnap] = await Promise.all([
        getDocs(collection(db, 'siteCalibrations')),
        getDocs(collection(db, 'users')),
      ]);

      const rcByUid = new Map<string, string>();
      userSnap.docs.forEach(d => {
        const data = d.data() as FirestoreUserDoc;
        if (data.role === 'rc_admin') {
          rcByUid.set(d.id, data.companyName || data.username || '—');
        }
      });

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

  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      if (!matchesVerificationSearch(record, searchTerm, { rcCenterName: record.rcCenterName })) {
        return false;
      }
      if (!matchesVerificationStatusFilter(record, statusFilter)) {
        return false;
      }
      if (rcFilter !== 'all' && (record.rcId || '') !== rcFilter) {
        return false;
      }
      return true;
    });
  }, [records, statusFilter, rcFilter, searchTerm]);

  const paginatedRecords = useMemo(
    () => paginateItems(filteredRecords, page, VERIFICATION_TABLE_PAGE_SIZE),
    [filteredRecords, page],
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter, rcFilter, searchTerm]);

  const counts = useMemo(() => tallyVerificationStatusFilters(records), [records]);

  const rcFilterOptions = useMemo(() => {
    const byRc = new Map<string, { label: string; count: number }>();
    for (const record of records) {
      const rcId = record.rcId?.trim() || 'unknown';
      const label = record.rcCenterName?.trim() || 'Unknown RC';
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
      { value: 'all', label: 'All', count: records.length },
      ...centres,
    ];
  }, [records]);

  const handleDelete = async (record: VerificationRow) => {
    if (!canDeleteVerification(record)) return;

    const label = `${record.customerName} · ${record.serialNumber || 'no serial'}`;
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
      await fetchRecords();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove verification.');
    } finally {
      setDeletingId(null);
    }
  };

  const filterOptions = buildVerificationStatusFilterOptions(counts);
  const rowOffset = (page - 1) * VERIFICATION_TABLE_PAGE_SIZE;

  return (
    <div className="fade-in page-content">
      {viewingRecord && (
        <VerificationDetailPanel
          record={viewingRecord}
          rcCenterName={viewingRecord.rcCenterName}
          onClose={() => setViewingRecord(null)}
        />
      )}

      <div className="panel glass panel--table">
        <div className="panel-header justify-between">
          <div>
            <h2>
              <ShieldCheck className="inline-icon text-blue" /> Verifications
            </h2>
            <p className="text-muted text-sm mt-1 mb-0">
              Super Admin view — all RC verification requests. Only draft records can be deleted.
            </p>
            {listError && (
              <p className="rc-form-topbar-error text-sm mt-1 mb-0" role="alert">
                {listError}
              </p>
            )}
          </div>
          <button className="btn-icon" onClick={() => void fetchRecords()} title="Refresh" type="button">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="panel-body p-0">
          <VerificationListFilters
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchPlaceholder="Search customer, serial, certificate, RC…"
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            statusOptions={filterOptions}
            rcFilter={rcFilter}
            onRcFilterChange={setRcFilter}
            rcOptions={rcFilterOptions}
          />

          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large" />
            </div>
          ) : (
            <>
              <VerificationListTable
                mode="admin"
                records={paginatedRecords}
                rowOffset={rowOffset}
                formatDate={formatVerificationListDate}
                emptyMessage="No verifications match the current filters."
                onView={record => setViewingRecord(record as VerificationRow)}
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
      </div>
    </div>
  );
};
