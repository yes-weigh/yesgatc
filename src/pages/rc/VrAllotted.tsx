import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDot, Hash, Layers, Pencil, Save, X } from 'lucide-react';
import { FilterIcon } from '../../components/FilterIcon';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useSetVrAllottedAppBar } from '../../context/VrAllottedAppBarContext';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import { useRcQuotaSeats } from '../../hooks/useRcQuotaSeats';
import { useRcCreatedVerifierCount } from '../../hooks/useRcCreatedVerifierCount';
import { fetchRcVerifierUsers } from '../../lib/rcVerifierMembers';
import { rcOvUsedFromRecords, saveVerifierInvoiceAllotment } from '../../lib/rcMasterQuota';
import { pasProductIdSet } from '../../lib/pasSerialBank';
import { roleCanOpenVrAllotted } from '../../lib/roleNav';
import {
  vrAllottedRangeFullyInPool,
  vrAllottedRangeQty,
  vrAllottedRangeSerials,
  vrAllottedScopedView,
} from '../../lib/vrAllotted';
import { uniqueSerials } from '../../lib/yesoneInboundData';
import type { FirestoreUserDoc, SiteCalibration } from '../../types';

type StatusFilter = 'all' | 'unused' | 'used';

function displayQty(value: number): string {
  return String(value);
}

function verifierLabel(user: FirestoreUserDoc & { uid: string }): string {
  return (user.username || user.aadhar || user.uid).trim().toUpperCase();
}

function todayIstDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatAllotDate(value: string): string {
  const raw = value.trim();
  if (!raw) return '—';
  const day = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [year, month, date] = day.split('-');
    return `${date}/${month}/${year}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function assignmentUids(row: {
  verifierUid: string;
  verifierUids?: string[];
}): string[] {
  return [...new Set([...(row.verifierUids || []), row.verifierUid].map(uid => uid.trim()).filter(Boolean))];
}

export const VrAllotted: React.FC = () => {
  const { user } = useAuth();
  const { products } = useAppContext();
  const setVrAllottedAppBar = useSetVrAllottedAppBar();
  const rcUid = user?.role === 'rc_admin' ? user.uid : null;
  const roster = useRcCreatedVerifierCount(rcUid);
  const canOpen = roleCanOpenVrAllotted(user?.role, roster.count > 0);

  const [verifiers, setVerifiers] = useState<Array<FirestoreUserDoc & { uid: string }>>([]);
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [listError, setListError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [allotOpen, setAllotOpen] = useState(false);
  const [editingInvoiceNo, setEditingInvoiceNo] = useState('');
  const [selectedUid, setSelectedUid] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [allottedAt, setAllottedAt] = useState(todayIstDate);
  const [serialStart, setSerialStart] = useState('');
  const [serialEnd, setSerialEnd] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [verifierFilter, setVerifierFilter] = useState('all');
  const [draftStatus, setDraftStatus] = useState<StatusFilter>('all');
  const [draftVerifier, setDraftVerifier] = useState('all');
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterSlots, setFilterSlots] = useState<{
    mobile: HTMLElement | null;
    desktop: HTMLElement | null;
  }>({ mobile: null, desktop: null });

  const seats = useRcQuotaSeats(rcUid, records);
  const pasProductIds = useMemo(() => pasProductIdSet(products), [products]);

  const loadVerifiers = useCallback(async () => {
    if (!rcUid) return;
    try {
      const rows = await fetchRcVerifierUsers(rcUid);
      setVerifiers(rows);
      setListError('');
    } catch {
      setVerifiers([]);
      setListError('Could not load verifiers.');
    }
  }, [rcUid]);

  useEffect(() => {
    void loadVerifiers();
  }, [loadVerifiers, roster.count]);

  useEffect(() => {
    if (!rcUid) {
      setRecords([]);
      return;
    }
    return onSnapshot(
      query(collection(db, 'siteCalibrations'), where('rcId', '==', rcUid)),
      snap => {
        setRecords(snap.docs.map(item => ({ id: item.id, ...item.data() }) as SiteCalibration));
      },
      () => setRecords([]),
    );
  }, [rcUid]);

  useLayoutEffect(() => {
    setFilterSlots({
      mobile: document.getElementById('verification-filter-slot-mobile'),
      desktop: document.getElementById('verification-filter-slot-desktop'),
    });
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    setDraftStatus(statusFilter);
    setDraftVerifier(verifierFilter);
  }, [filterOpen, statusFilter, verifierFilter]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (filterRef.current?.contains(target as Node)) return;
      if (target instanceof HTMLElement && (target.tagName === 'OPTION' || target.closest('select'))) {
        return;
      }
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const applyFilters = () => {
    setStatusFilter(draftStatus);
    setVerifierFilter(draftVerifier);
    setFilterOpen(false);
  };

  const clearFilters = () => {
    setDraftStatus('all');
    setDraftVerifier('all');
    setStatusFilter('all');
    setVerifierFilter('all');
    setFilterOpen(false);
  };

  const closeAllot = useCallback(() => {
    setAllotOpen(false);
  }, []);

  const openCreateToggle = useCallback(() => {
    setAllotOpen(open => {
      setEditingInvoiceNo('');
      return !open;
    });
  }, []);

  useHistoryOverlay(allotOpen, closeAllot);

  useLayoutEffect(() => {
    if (!setVrAllottedAppBar) return;
    if (user?.role !== 'rc_admin' || !canOpen) {
      setVrAllottedAppBar(null);
      return;
    }
    setVrAllottedAppBar({ onAllot: openCreateToggle, allotOpen });
    return () => setVrAllottedAppBar(null);
  }, [allotOpen, canOpen, openCreateToggle, setVrAllottedAppBar, user?.role]);

  const usedSerials = useMemo(
    () => rcOvUsedFromRecords(records, { pasProductIds }).serials,
    [pasProductIds, records],
  );

  const rosterUids = useMemo(() => verifiers.map(row => row.uid), [verifiers]);

  const scoped = useMemo(
    () =>
      vrAllottedScopedView({
        allottedByUid: seats.allottedByUid,
        usedSerials,
        voidedSerials: seats.voidedSerials,
        reservedSerials: seats.reservedSerials,
        reservedForUids: seats.reservedForUids,
        rosterUids,
        verifierFilter,
        statusFilter,
      }),
    [
      rosterUids,
      seats.allottedByUid,
      seats.reservedForUids,
      seats.reservedSerials,
      seats.voidedSerials,
      statusFilter,
      usedSerials,
      verifierFilter,
    ],
  );

  const allottedSeats = scoped.allSeats;
  const filteredSeats = scoped.seats;
  const tileTotals = scoped.totals;

  const filterActive = statusFilter !== 'all' || verifierFilter !== 'all';

  const unusedPool = useMemo(() => {
    return uniqueSerials([
      ...seats.remaining,
      ...allottedSeats.filter(seat => !seat.used).map(seat => seat.serial),
    ]);
  }, [allottedSeats, seats.remaining]);

  const editingSerials = useMemo(() => {
    if (!editingInvoiceNo) return [];
    const row = seats.reservedAssignments.find(
      item => item.invoiceNo.trim().toUpperCase() === editingInvoiceNo.trim().toUpperCase(),
    );
    if (!row?.serialStart) return [];
    return vrAllottedRangeSerials(row.serialStart, row.serialEnd || row.serialStart);
  }, [editingInvoiceNo, seats.reservedAssignments]);

  const allowedPool = useMemo(
    () => uniqueSerials([...unusedPool, ...editingSerials]),
    [editingSerials, unusedPool],
  );

  const rangeQty = vrAllottedRangeQty(serialStart, serialEnd);
  const rangeOk = vrAllottedRangeFullyInPool(serialStart, serialEnd, allowedPool);

  const names = useMemo(
    () => new Map(verifiers.map(row => [row.uid, verifierLabel(row)])),
    [verifiers],
  );

  const assignmentRows = useMemo(() => {
    return seats.reservedAssignments.map(row => {
      const serials = row.serialStart
        ? vrAllottedRangeSerials(row.serialStart, row.serialEnd || row.serialStart)
        : [];
      return {
        ...row,
        qty: serials.length,
      };
    });
  }, [seats.reservedAssignments]);

  useEffect(() => {
    if (!allotOpen) return;
    setSaveError('');
    if (editingInvoiceNo) return;
    setInvoiceNo('');
    setAllottedAt(todayIstDate());
    setSerialStart('');
    setSerialEnd('');
    setSelectedUid(verifiers[0]?.uid || '');
  }, [allotOpen, editingInvoiceNo, verifiers]);

  const openEdit = (row: (typeof assignmentRows)[number]) => {
    setEditingInvoiceNo(row.invoiceNo);
    setInvoiceNo(row.invoiceNo);
    setAllottedAt((row.allottedAt || '').slice(0, 10) || todayIstDate());
    setSerialStart(row.serialStart || '');
    setSerialEnd(row.serialEnd || row.serialStart || '');
    setSelectedUid(assignmentUids(row)[0] || '');
    setSaveError('');
  };

  const handleSave = async () => {
    if (!rcUid || saving || !selectedUid || !invoiceNo.trim() || !allottedAt.trim() || !rangeOk) return;
    setSaveError('');
    setSaving(true);
    try {
      await saveVerifierInvoiceAllotment({
        rcUid,
        invoiceNo,
        prevInvoiceNo: editingInvoiceNo || undefined,
        serialStart,
        serialEnd,
        verifierUids: [selectedUid],
        allottedAt,
        allowedSerials: allowedPool,
      });
      setEditingInvoiceNo('');
      setInvoiceNo('');
      setAllottedAt(todayIstDate());
      setSerialStart('');
      setSerialEnd('');
      setSelectedUid(verifiers[0]?.uid || '');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save allotment.');
    } finally {
      setSaving(false);
    }
  };

  const filterSlot = filterSlots.mobile ?? filterSlots.desktop;
  const filterControl = (
    <div className="wl-cert-filter verification-app-filter" ref={filterRef}>
      <button
        type="button"
        className={`wl-cert-filter-btn verification-app-filter__btn${
          filterOpen || filterActive ? ' wl-cert-filter-btn--on verification-app-filter__btn--on' : ''
        }`}
        aria-label="Filter allotted seats"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen(open => !open)}
      >
        <FilterIcon size={18} />
      </button>
      {filterOpen ? (
        <div className="wl-cert-filter__pop" role="dialog" aria-label="Vr Allotted filters">
          <label className="wl-cert-filter__label" htmlFor="vr-allotted-status">
            Status
          </label>
          <select
            id="vr-allotted-status"
            className="wl-cert-filter__select"
            value={draftStatus}
            onChange={event => setDraftStatus(event.target.value as StatusFilter)}
          >
            <option value="all">All</option>
            <option value="unused">Unused</option>
            <option value="used">Used</option>
          </select>
          <label className="wl-cert-filter__label" htmlFor="vr-allotted-verifier">
            Verifier
          </label>
          <select
            id="vr-allotted-verifier"
            className="wl-cert-filter__select"
            value={draftVerifier}
            onChange={event => setDraftVerifier(event.target.value)}
          >
            <option value="all">All</option>
            {verifiers.map(row => (
              <option key={row.uid} value={row.uid}>
                {verifierLabel(row)}
              </option>
            ))}
          </select>
          <div className="verification-app-filter__foot">
            <button type="button" className="verification-app-filter__clear" onClick={clearFilters}>
              Clear
            </button>
            <button type="button" className="verification-app-filter__apply" onClick={applyFilters}>
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (user?.role !== 'rc_admin') {
    return <Navigate to="/rc" replace />;
  }
  if (!roster.ready) {
    return (
      <div className="fade-in page-content">
        <div className="rc-vehicles-loading">
          <span className="spinner-inline large" />
        </div>
      </div>
    );
  }
  if (!canOpen) {
    return <Navigate to="/rc/certificates" replace />;
  }

  const allotDialog = allotOpen
    ? createPortal(
        <div
          className="reports-reserve-overlay"
          role="presentation"
          onClick={() => !saving && closeAllot()}
        >
          <div
            className="reports-reserve-dialog vr-allotted-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vr-allotted-dialog-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="rv-payment-panel-close"
              aria-label="Close"
              disabled={saving}
              onClick={closeAllot}
            >
              <X size={18} />
            </button>
            <h2 id="vr-allotted-dialog-title" className="reports-reserve-dialog__title">
              Previously allotted
            </h2>
            <section className="vr-allotted-history">
              {assignmentRows.length === 0 ? (
                <p className="text-muted text-sm">No allotments yet.</p>
              ) : (
                <div className="table-scroll-wrap">
                  <table className="data-table vr-allotted-history-table">
                    <thead>
                      <tr>
                        <th>Verifier</th>
                        <th>Invoice no</th>
                        <th>Date</th>
                        <th>Start no</th>
                        <th>End no</th>
                        <th>Total qty</th>
                        <th>
                          <span className="sr-only">Edit</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignmentRows.map(row => (
                        <tr key={row.invoiceNo}>
                          <td>
                            {assignmentUids(row)
                              .map(uid => names.get(uid) || uid)
                              .join(', ')}
                          </td>
                          <td className="text-mono">{row.invoiceNo}</td>
                          <td>{formatAllotDate(row.allottedAt || '')}</td>
                          <td className="text-mono">{row.serialStart || '—'}</td>
                          <td className="text-mono">{row.serialEnd || row.serialStart || '—'}</td>
                          <td className="text-mono">{row.qty}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm vr-allotted-history-edit"
                              aria-label={`Edit allotment ${row.invoiceNo}`}
                              onClick={() => openEdit(row)}
                            >
                              <Pencil size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <h3 className="vr-allotted-history__title">
              {editingInvoiceNo ? 'Edit allotment' : 'New allotment'}
            </h3>
            {listError ? <p className="login-error">{listError}</p> : null}
            <label className="reports-reserve-dialog__label" htmlFor="vr-allotted-pick-verifier">
              Verifier
            </label>
            <select
              id="vr-allotted-pick-verifier"
              className="form-control"
              value={selectedUid}
              onChange={event => setSelectedUid(event.target.value)}
              disabled={saving || verifiers.length === 0}
            >
              {verifiers.length === 0 ? (
                <option value="">Add a verifier first</option>
              ) : null}
              {verifiers.map(row => (
                <option key={row.uid} value={row.uid}>
                  {verifierLabel(row)}
                </option>
              ))}
            </select>
            <label className="reports-reserve-dialog__label" htmlFor="vr-allotted-invoice">
              Invoice number
            </label>
            <input
              id="vr-allotted-invoice"
              className="form-control"
              value={invoiceNo}
              onChange={event => setInvoiceNo(event.target.value)}
              disabled={saving}
              autoComplete="off"
            />
            <label className="reports-reserve-dialog__label" htmlFor="vr-allotted-date">
              Date
            </label>
            <input
              id="vr-allotted-date"
              className="form-control"
              type="date"
              value={allottedAt}
              onChange={event => setAllottedAt(event.target.value)}
              disabled={saving}
            />
            <div className="vr-allotted-dialog__range">
              <div>
                <label className="reports-reserve-dialog__label" htmlFor="vr-allotted-start">
                  Start no
                </label>
                <input
                  id="vr-allotted-start"
                  className="form-control text-mono"
                  value={serialStart}
                  onChange={event => setSerialStart(event.target.value)}
                  disabled={saving}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="reports-reserve-dialog__label" htmlFor="vr-allotted-end">
                  End no
                </label>
                <input
                  id="vr-allotted-end"
                  className="form-control text-mono"
                  value={serialEnd}
                  onChange={event => setSerialEnd(event.target.value)}
                  disabled={saving}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="reports-reserve-dialog__label" htmlFor="vr-allotted-qty">
                  Qty
                </label>
                <input
                  id="vr-allotted-qty"
                  className="form-control text-mono"
                  value={rangeQty || ''}
                  readOnly
                  tabIndex={-1}
                />
              </div>
            </div>
            {serialStart.trim() && !rangeOk ? (
              <p className="login-error">Range must exist in unused GAS seats.</p>
            ) : null}
            {saveError ? <p className="login-error">{saveError}</p> : null}
            <div className="reports-reserve-dialog__actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => {
                  if (editingInvoiceNo) {
                    setEditingInvoiceNo('');
                    setInvoiceNo('');
                    setAllottedAt(todayIstDate());
                    setSerialStart('');
                    setSerialEnd('');
                    setSelectedUid(verifiers[0]?.uid || '');
                    return;
                  }
                  closeAllot();
                }}
              >
                {editingInvoiceNo ? 'Cancel edit' : 'Close'}
              </button>
              <button
                type="button"
                className="btn btn-primary flex items-center gap-2"
                disabled={
                  saving
                  || !selectedUid
                  || !invoiceNo.trim()
                  || !allottedAt.trim()
                  || !rangeOk
                }
                onClick={() => void handleSave()}
              >
                {saving ? <span className="spinner-inline" /> : <Save size={16} />}
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="fade-in page-content vr-allotted-page">
      {filterSlot ? createPortal(filterControl, filterSlot) : filterControl}
      {allotDialog}

      <div className="rc-summary-row">
        <article className="rc-summary-tile rc-summary-tile--blue">
          <p className="rc-summary-tile__label">
            <Layers size={16} strokeWidth={2.2} aria-hidden />
            Allotted
          </p>
          <p className="rc-summary-tile__value">{displayQty(tileTotals.allotted)}</p>
        </article>
        <article className="rc-summary-tile rc-summary-tile--pink">
          <p className="rc-summary-tile__label">
            <CircleDot size={16} strokeWidth={2.2} aria-hidden />
            Used
          </p>
          <p className="rc-summary-tile__value">{displayQty(tileTotals.used)}</p>
        </article>
        <article className="rc-summary-tile rc-summary-tile--green">
          <p className="rc-summary-tile__label">
            <Hash size={16} strokeWidth={2.2} aria-hidden />
            Unused
          </p>
          <p className="rc-summary-tile__value">{displayQty(tileTotals.unused)}</p>
        </article>
      </div>

      {allotOpen ? null : !seats.ready ? (
        <div className="rc-vehicles-loading">
          <span className="spinner-inline large" />
        </div>
      ) : filteredSeats.length === 0 ? (
        <p className="text-muted text-sm">
          {filterActive ? 'No allotted seats match this filter.' : 'No allotted seats.'}
        </p>
      ) : (
        <ul className="admin-setting-serial-seats vr-allotted-seats" aria-label="Allotted seats">
          {filteredSeats.map(seat => (
            <li
              key={seat.serial}
              className={`admin-setting-serial-seat text-mono${
                seat.used ? ' admin-setting-serial-seat--used' : ''
              }`}
            >
              {seat.serial}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
