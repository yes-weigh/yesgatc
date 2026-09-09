import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { Calendar, CircleDot, CloudUpload, Eye, Hash, Layers, Paperclip, Pencil, X } from 'lucide-react';
import { FilterIcon } from '../../components/FilterIcon';
import { StorageImage } from '../../components/StorageImage';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useSetVrAllottedAppBar } from '../../context/VrAllottedAppBarContext';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import { useRcQuotaSeats } from '../../hooks/useRcQuotaSeats';
import { useRcCreatedVerifierCount } from '../../hooks/useRcCreatedVerifierCount';
import { fetchRcVerifierUsers } from '../../lib/rcVerifierMembers';
import {
  rcOvUsedFromRecords,
  saveVerifierInvoiceAllotment,
  type ReservedAssignmentInvoiceFile,
  type YesoneReservedAssignment,
} from '../../lib/rcMasterQuota';
import { deleteProductStorageFile, isPdfContentType } from '../../lib/productApprovalUpload';
import { pasProductIdSet } from '../../lib/pasSerialBank';
import { roleCanOpenVrAllotted } from '../../lib/roleNav';
import { uploadVrAllotmentInvoice } from '../../lib/vrAllottedInvoiceUpload';
import {
  vrAllottedEntryMatchesFilter,
  vrAllottedEntrySerials,
  vrAllottedRangeFullyInPool,
  vrAllottedRangeQty,
  vrAllottedRangeSerials,
  vrAllottedScopedView,
} from '../../lib/vrAllotted';
import { uniqueSerials } from '../../lib/yesoneInboundData';
import type { FirestoreUserDoc, SiteCalibration } from '../../types';

type StatusFilter = 'all' | 'unused' | 'used';

const INVOICE_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/gif';

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

function invoiceFileFromRow(row: {
  invoiceUrl?: string;
  invoicePath?: string;
  invoiceName?: string;
  invoiceContentType?: string;
}): ReservedAssignmentInvoiceFile | null {
  const url = (row.invoiceUrl || '').trim();
  const path = (row.invoicePath || '').trim();
  if (!url && !path) return null;
  return {
    url,
    ...(path ? { path } : {}),
    ...(row.invoiceName?.trim() ? { name: row.invoiceName.trim() } : {}),
    ...(row.invoiceContentType?.trim() ? { contentType: row.invoiceContentType.trim() } : {}),
  };
}

function isInvoiceImage(contentType?: string, name?: string): boolean {
  const type = (contentType || '').trim().toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type === 'application/pdf' || isPdfContentType(contentType)) return false;
  return /\.(jpe?g|png|webp|gif)$/i.test(name || '');
}

function InvoiceFilePreview({
  invoice,
  href,
}: {
  invoice: ReservedAssignmentInvoiceFile;
  href?: string;
}) {
  const openHref = (href || invoice.url || '').trim();
  const image = isInvoiceImage(invoice.contentType, invoice.name);
  const body = image && (invoice.url || invoice.path) ? (
    invoice.path ? (
      <StorageImage
        url={invoice.url}
        path={invoice.path}
        alt=""
        className="vr-allotted-invoice-thumb"
      />
    ) : (
      <img src={invoice.url} alt="" className="vr-allotted-invoice-thumb" />
    )
  ) : (
    <>
      <Paperclip size={16} aria-hidden />
      <span>{invoice.name || 'Invoice'}</span>
    </>
  );
  if (!openHref) {
    return <span className="vr-allotted-invoice-link">{body}</span>;
  }
  return (
    <a
      href={openHref}
      target="_blank"
      rel="noopener noreferrer"
      className="vr-allotted-invoice-link"
    >
      {body}
    </a>
  );
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
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [existingInvoice, setExistingInvoice] = useState<ReservedAssignmentInvoiceFile | null>(null);
  const [invoicePreviewUrl, setInvoicePreviewUrl] = useState('');
  const [dropOver, setDropOver] = useState(false);
  const [expandedInvoiceNo, setExpandedInvoiceNo] = useState('');
  const invoiceFileRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!invoiceFile || !isInvoiceImage(invoiceFile.type, invoiceFile.name)) {
      setInvoicePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(invoiceFile);
    setInvoicePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [invoiceFile]);

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

  const resetAllotForm = useCallback((nextUid = '') => {
    setEditingInvoiceNo('');
    setInvoiceNo('');
    setAllottedAt(todayIstDate());
    setSerialStart('');
    setSerialEnd('');
    setSelectedUid(nextUid);
    setInvoiceFile(null);
    setExistingInvoice(null);
    setDropOver(false);
    if (invoiceFileRef.current) invoiceFileRef.current.value = '';
  }, []);

  const openCreateToggle = useCallback(() => {
    if (allotOpen) {
      setAllotOpen(false);
      return;
    }
    resetAllotForm(verifiers[0]?.uid || '');
    setAllotOpen(true);
  }, [allotOpen, resetAllotForm, verifiers]);

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
      const entrySeats = vrAllottedEntrySerials({
        serialStart: row.serialStart,
        serialEnd: row.serialEnd,
        usedSerials,
        voidedSerials: seats.voidedSerials,
      });
      return {
        ...row,
        qty: entrySeats.length,
        seats: entrySeats,
      };
    });
  }, [seats.reservedAssignments, seats.voidedSerials, usedSerials]);

  const visibleEntries = useMemo(
    () =>
      assignmentRows.filter(row =>
        vrAllottedEntryMatchesFilter({
          verifierUids: assignmentUids(row),
          seats: row.seats,
          verifierFilter,
          statusFilter,
        }),
      ),
    [assignmentRows, statusFilter, verifierFilter],
  );

  const previousAllotments = useMemo(() => {
    return [...assignmentRows].sort((a, b) => {
      const byDate = (b.allottedAt || '').slice(0, 10).localeCompare((a.allottedAt || '').slice(0, 10));
      if (byDate !== 0) return byDate;
      return b.invoiceNo.localeCompare(a.invoiceNo);
    });
  }, [assignmentRows]);

  useEffect(() => {
    if (!allotOpen) return;
    setSaveError('');
  }, [allotOpen]);

  const openEdit = (row: YesoneReservedAssignment) => {
    setEditingInvoiceNo(row.invoiceNo);
    setInvoiceNo(row.invoiceNo);
    setAllottedAt((row.allottedAt || '').slice(0, 10) || todayIstDate());
    setSerialStart(row.serialStart || '');
    setSerialEnd(row.serialEnd || row.serialStart || '');
    setSelectedUid(assignmentUids(row)[0] || '');
    setInvoiceFile(null);
    setExistingInvoice(invoiceFileFromRow(row));
    setDropOver(false);
    if (invoiceFileRef.current) invoiceFileRef.current.value = '';
    setSaveError('');
    setAllotOpen(true);
  };

  const handleInvoicePick = (file?: File | null) => {
    if (!file) return;
    setInvoiceFile(file);
  };

  const handleSave = async () => {
    if (!rcUid || saving || !selectedUid || !invoiceNo.trim() || !allottedAt.trim() || !rangeOk) return;
    setSaveError('');
    setSaving(true);
    try {
      let invoice = existingInvoice || undefined;
      if (invoiceFile) {
        invoice = await uploadVrAllotmentInvoice(rcUid, invoiceFile);
        if (existingInvoice?.path && existingInvoice.path !== invoice.path) {
          void deleteProductStorageFile(existingInvoice.path).catch(() => undefined);
        }
      }
      await saveVerifierInvoiceAllotment({
        rcUid,
        invoiceNo,
        prevInvoiceNo: editingInvoiceNo || undefined,
        serialStart,
        serialEnd,
        verifierUids: [selectedUid],
        allottedAt,
        allowedSerials: allowedPool,
        ...(invoice ? { invoice } : {}),
      });
      resetAllotForm(verifiers[0]?.uid || '');
      closeAllot();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save allotment.');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving;
  const formInvoice = invoiceFile
    ? {
        url: invoicePreviewUrl,
        name: invoiceFile.name,
        contentType: invoiceFile.type,
      }
    : existingInvoice;

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
          onClick={() => !busy && closeAllot()}
        >
          <div
            className="reports-reserve-dialog vr-allotted-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vr-allotted-dialog-title"
            onClick={event => event.stopPropagation()}
          >
            <header className="vr-allotted-dialog__head">
              <h2 id="vr-allotted-dialog-title" className="vr-allotted-dialog__title">
                Invoice Allotment
              </h2>
              <button
                type="button"
                className="vr-allotted-dialog__close"
                aria-label="Close"
                disabled={busy}
                onClick={closeAllot}
              >
                <X size={18} strokeWidth={2.2} />
              </button>
            </header>
            <section className="vr-allotted-prev" aria-label="Previous allotment">
              <h3 className="vr-allotted-prev__label">Previous allotment</h3>
              <div className="vr-allotted-prev__card">
                {(previousAllotments.length > 0 ? previousAllotments : [null]).map(row => (
                  <div key={row?.invoiceNo || 'empty'} className="vr-allotted-prev__row">
                    <div className="vr-allotted-prev__cell">
                      <span className="vr-allotted-prev__key">Verifier</span>
                      <span className="vr-allotted-prev__val">
                        {row
                          ? assignmentUids(row)
                              .map(uid => names.get(uid) || uid)
                              .join(', ') || '—'
                          : '—'}
                      </span>
                    </div>
                    <div className="vr-allotted-prev__cell">
                      <span className="vr-allotted-prev__key">Invoice no</span>
                      <span className="vr-allotted-prev__val">{row?.invoiceNo || '—'}</span>
                    </div>
                    <div className="vr-allotted-prev__cell">
                      <span className="vr-allotted-prev__key">Date</span>
                      <span className="vr-allotted-prev__val">
                        {row ? formatAllotDate(row.allottedAt || '') : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="vr-allotted-form">
              {listError ? <p className="login-error">{listError}</p> : null}
              <label className="vr-allotted-dialog__label" htmlFor="vr-allotted-pick-verifier">
                Select verifier
              </label>
              <select
                id="vr-allotted-pick-verifier"
                className="input-field"
                value={selectedUid}
                onChange={event => setSelectedUid(event.target.value)}
                disabled={busy || verifiers.length === 0}
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
              <label className="vr-allotted-dialog__label" htmlFor="vr-allotted-invoice">
                Invoice no
              </label>
              <input
                id="vr-allotted-invoice"
                className="input-field"
                value={invoiceNo}
                onChange={event => setInvoiceNo(event.target.value)}
                disabled={busy}
                autoComplete="off"
                placeholder="Enter invoice no"
              />
              <label className="vr-allotted-dialog__label" htmlFor="vr-allotted-date">
                Date
              </label>
              <div className="vr-allotted-dialog__date">
                <input
                  id="vr-allotted-date"
                  className="input-field"
                  type="date"
                  value={allottedAt}
                  onChange={event => setAllottedAt(event.target.value)}
                  disabled={busy}
                />
                <Calendar className="vr-allotted-dialog__date-icon" size={16} strokeWidth={2} aria-hidden />
              </div>
              <div className="vr-allotted-dialog__range">
                <div>
                  <label className="vr-allotted-dialog__label" htmlFor="vr-allotted-start">
                    Serial start no
                  </label>
                  <input
                    id="vr-allotted-start"
                    className="input-field text-mono"
                    value={serialStart}
                    onChange={event => setSerialStart(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                    placeholder="Start no"
                  />
                </div>
                <div>
                  <label className="vr-allotted-dialog__label" htmlFor="vr-allotted-end">
                    End number
                  </label>
                  <input
                    id="vr-allotted-end"
                    className="input-field text-mono"
                    value={serialEnd}
                    onChange={event => setSerialEnd(event.target.value)}
                    disabled={busy}
                    autoComplete="off"
                    placeholder="End no"
                  />
                </div>
                <div>
                  <label className="vr-allotted-dialog__label" htmlFor="vr-allotted-qty">
                    Qty
                  </label>
                  <input
                    id="vr-allotted-qty"
                    className="input-field text-mono"
                    value={rangeQty || ''}
                    readOnly
                    tabIndex={-1}
                    placeholder="Qty"
                  />
                </div>
              </div>
              <span className="vr-allotted-dialog__label">Upload images</span>
              <label
                className={`vr-allotted-drop${dropOver ? ' is-over' : ''}${formInvoice ? ' has-file' : ''}`}
                htmlFor="vr-allotted-invoice-file"
                onDragOver={event => {
                  event.preventDefault();
                  if (!busy) setDropOver(true);
                }}
                onDragLeave={event => {
                  if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                  setDropOver(false);
                }}
                onDrop={event => {
                  event.preventDefault();
                  setDropOver(false);
                  if (!busy) handleInvoicePick(event.dataTransfer.files[0]);
                }}
              >
                {formInvoice ? (
                  <>
                    <div
                      className="vr-allotted-drop__file"
                      onClick={event => event.stopPropagation()}
                      onKeyDown={event => event.stopPropagation()}
                    >
                      <InvoiceFilePreview
                        invoice={formInvoice}
                        href={invoiceFile ? undefined : formInvoice.url}
                      />
                    </div>
                    <span className="vr-allotted-drop__title">Tap to replace</span>
                    <span className="vr-allotted-drop__hint">JPG, PNG or PDF</span>
                  </>
                ) : (
                  <>
                    <CloudUpload size={28} strokeWidth={1.8} aria-hidden />
                    <span className="vr-allotted-drop__title">Tap to upload images</span>
                    <span className="vr-allotted-drop__hint">JPG, PNG or PDF</span>
                  </>
                )}
              </label>
              <input
                id="vr-allotted-invoice-file"
                ref={invoiceFileRef}
                type="file"
                accept={INVOICE_FILE_ACCEPT}
                hidden
                disabled={busy}
                onChange={event => {
                  handleInvoicePick(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {serialStart.trim() && !rangeOk ? (
                <p className="login-error">Range must exist in unused GAS seats.</p>
              ) : null}
              {saveError ? <p className="login-error">{saveError}</p> : null}
              <button
                type="button"
                className="btn btn-primary vr-allotted-dialog__save"
                disabled={
                  busy
                  || !selectedUid
                  || !invoiceNo.trim()
                  || !allottedAt.trim()
                  || !rangeOk
                }
                onClick={() => void handleSave()}
              >
                {saving ? <span className="spinner-inline" /> : null}
                Save allotment
              </button>
            </section>
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

      {!seats.ready ? (
        <div className="rc-vehicles-loading">
          <span className="spinner-inline large" />
        </div>
      ) : visibleEntries.length === 0 ? (
        <p className="text-muted text-sm">
          {filterActive
            ? 'No allotment entries match this filter.'
            : assignmentRows.length === 0
              ? 'No allotment entries.'
              : 'No allotment entries match this filter.'}
        </p>
      ) : (
        <ul className="vr-allotted-entries" aria-label="Allotment entries">
          {visibleEntries.map(row => {
            const expanded = expandedInvoiceNo === row.invoiceNo;
            return (
              <li key={row.invoiceNo} className="vr-allotted-entry">
                <div className="vr-allotted-entry__head">
                  <div className="vr-allotted-entry__fields">
                    <div>
                      <span className="vr-allotted-entry__label">Verifier name</span>
                      <span className="vr-allotted-entry__value">
                        {assignmentUids(row)
                          .map(uid => names.get(uid) || uid)
                          .join(', ')}
                      </span>
                    </div>
                    <div>
                      <span className="vr-allotted-entry__label">Date</span>
                      <span className="vr-allotted-entry__value">
                        {formatAllotDate(row.allottedAt || '')}
                      </span>
                    </div>
                    <div>
                      <span className="vr-allotted-entry__label">Invoice no</span>
                      <span className="vr-allotted-entry__value text-mono">{row.invoiceNo}</span>
                    </div>
                    <div>
                      <span className="vr-allotted-entry__label">Start no</span>
                      <span className="vr-allotted-entry__value text-mono">
                        {row.serialStart || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="vr-allotted-entry__label">End no</span>
                      <span className="vr-allotted-entry__value text-mono">
                        {row.serialEnd || row.serialStart || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="vr-allotted-entry__label">Qty</span>
                      <span className="vr-allotted-entry__value text-mono">
                        {row.serialStart ? row.qty : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="vr-allotted-entry__actions">
                    <button
                      type="button"
                      className={`vr-allotted-entry__icon${expanded ? ' is-on' : ''}`}
                      aria-label={
                        expanded
                          ? `Hide serials for ${row.invoiceNo}`
                          : `Show serials for ${row.invoiceNo}`
                      }
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedInvoiceNo(current =>
                          current === row.invoiceNo ? '' : row.invoiceNo,
                        )
                      }
                    >
                      <Eye size={16} strokeWidth={2.2} />
                    </button>
                    <button
                      type="button"
                      className="vr-allotted-entry__icon"
                      aria-label={`Edit allotment ${row.invoiceNo}`}
                      onClick={() => openEdit(row)}
                    >
                      <Pencil size={16} strokeWidth={2.2} />
                    </button>
                  </div>
                </div>
                {expanded ? (
                  row.seats.length === 0 ? (
                    <p className="text-muted text-sm vr-allotted-entry__empty">
                      No serials on this entry.
                    </p>
                  ) : (
                    <ul
                      className="admin-setting-serial-seats vr-allotted-seats"
                      aria-label={`Serials for ${row.invoiceNo}`}
                    >
                      {row.seats.map(seat => (
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
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
