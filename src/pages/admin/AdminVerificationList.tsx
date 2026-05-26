import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirm } from '../../context/ConfirmContext';
import {
  canAdminDeleteVerification,
  formatVerificationCapAcc,
  normalizeVerificationStatus,
  verificationStatusLabel,
  verificationVctLabel,
} from '../../lib/verificationRequest';
import { ShieldCheck, RefreshCw, Trash2 } from 'lucide-react';
import type { FirestoreUserDoc, SiteCalibration, VerificationRequestStatus } from '../../types';

type StatusFilter = VerificationRequestStatus | 'all';

interface VerificationRow extends SiteCalibration {
  rcCenterName: string;
}

export const AdminVerificationList: React.FC = () => {
  const confirm = useConfirm();
  const [records, setRecords] = useState<VerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('submitted');
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
    if (statusFilter === 'all') return records;
    return records.filter(r => normalizeVerificationStatus(r) === statusFilter);
  }, [records, statusFilter]);

  const counts = useMemo(() => {
    const tally = { all: records.length, draft: 0, submitted: 0, approved: 0 };
    for (const record of records) {
      tally[normalizeVerificationStatus(record)] += 1;
    }
    return tally;
  }, [records]);

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const handleDelete = async (record: VerificationRow) => {
    if (!canAdminDeleteVerification(record)) return;

    const status = normalizeVerificationStatus(record);
    const label = `${record.customerName} · ${record.serialNumber || 'no serial'}`;
    const ok = await confirm({
      title: 'Remove verification?',
      message:
        status === 'submitted'
          ? `Remove submitted verification "${label}"?\n\nThe certificate server is not live yet — this clears the queue for testing. RC users cannot delete submitted records.`
          : `Remove approved verification "${label}"?\n\nThis cannot be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(record.id);
    try {
      await deleteDoc(doc(db, 'siteCalibrations', record.id));
      await fetchRecords();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove verification.');
    } finally {
      setDeletingId(null);
    }
  };

  const renderStatusBadge = (record: SiteCalibration) => {
    const status = normalizeVerificationStatus(record);
    return (
      <span className={`status-badge verification-status verification-status--${status}`}>
        {verificationStatusLabel(status)}
      </span>
    );
  };

  const filterOptions: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'submitted', label: 'Submitted', count: counts.submitted },
    { value: 'approved', label: 'Approved', count: counts.approved },
    { value: 'draft', label: 'Draft', count: counts.draft },
    { value: 'all', label: 'All', count: counts.all },
  ];

  return (
    <div className="fade-in page-content">
      <div className="panel glass panel--table">
        <div className="panel-header justify-between">
          <div>
            <h2>
              <ShieldCheck className="inline-icon text-blue" /> Verifications
            </h2>
            <p className="text-muted text-sm mt-1 mb-0">
              Super Admin queue management — delete submitted or approved records until the certificate server is live.
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
          <div className="admin-verification-filters">
            {filterOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`admin-verification-filter${statusFilter === opt.value ? ' admin-verification-filter--active' : ''}`}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
                <span className="badge-count">{opt.count}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large" />
            </div>
          ) : (
            <div className="table-scroll-wrap">
              <table className="data-table data-table--site-calibration data-table--mobile-cards">
                <thead>
                  <tr>
                    <th className="site-calibration-col-serial">#</th>
                    <th>Date</th>
                    <th>RC centre</th>
                    <th>VCT</th>
                    <th>Type</th>
                    <th>Customer</th>
                    <th className="site-calibration-col-cap-acc">Cap/Acc</th>
                    <th>Serial</th>
                    <th>Status</th>
                    <th className="text-right site-calibration-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record, index) => {
                    const deletable = canAdminDeleteVerification(record);
                    return (
                      <tr key={record.id} className="table-mobile-row table-mobile-row--actions">
                        <td className="site-calibration-col-serial text-muted text-sm table-mobile-col-hide">
                          {index + 1}
                        </td>
                        <td className="text-sm table-mobile-col-hide">{formatDate(record.createdAt)}</td>
                        <td className="text-sm table-mobile-col-hide">{record.rcCenterName}</td>
                        <td className="text-sm table-mobile-col-hide">{verificationVctLabel(record)}</td>
                        <td className="table-mobile-col-hide">
                          <span
                            className={`status-badge ${
                              record.verificationType === 'OV'
                                ? 'site-calibration-type-ov'
                                : 'site-calibration-type-rv'
                            }`}
                          >
                            {record.verificationType}
                          </span>
                        </td>
                        <td className="font-medium table-mobile-col-primary">
                          <span className="table-mobile-primary-text">{record.customerName || '—'}</span>
                          <div className="table-mobile-summary">
                            <span className="table-mobile-summary-badges">
                              {renderStatusBadge(record)}
                              <span
                                className={`status-badge ${
                                  record.verificationType === 'OV'
                                    ? 'site-calibration-type-ov'
                                    : 'site-calibration-type-rv'
                                }`}
                              >
                                {record.verificationType}
                              </span>
                            </span>
                            <span>{record.rcCenterName}</span>
                            <span className="site-calibration-cap-acc-inline">
                              {formatVerificationCapAcc(record)} · {record.serialNumber || '—'}
                            </span>
                          </div>
                        </td>
                        <td className="text-sm table-mobile-col-hide site-calibration-col-cap-acc">
                          {formatVerificationCapAcc(record)}
                        </td>
                        <td className="text-sm text-mono table-mobile-col-hide">{record.serialNumber || '—'}</td>
                        <td className="table-mobile-col-hide">{renderStatusBadge(record)}</td>
                        <td className="text-right site-calibration-col-actions table-mobile-col-actions">
                          {deletable ? (
                            <button
                              type="button"
                              className="btn-icon text-red"
                              onClick={() => void handleDelete(record)}
                              disabled={deletingId === record.id}
                              title="Remove verification (Super Admin)"
                              aria-label={`Remove verification for ${record.customerName}`}
                            >
                              <Trash2 size={18} />
                            </button>
                          ) : (
                            <span className="text-muted text-xs">RC draft</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRecords.length === 0 && (
                    <tr>
                      <td colSpan={10} className="text-center py-10 text-muted">
                        No {statusFilter === 'all' ? '' : `${statusFilter} `}verifications found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
