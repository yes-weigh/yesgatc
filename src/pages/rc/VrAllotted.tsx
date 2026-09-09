import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDot, Hash, Layers, Save, Search, Trash2 } from 'lucide-react';
import { FilterIcon } from '../../components/FilterIcon';
import { db } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useRcQuotaSeats } from '../../hooks/useRcQuotaSeats';
import { useRcCreatedVerifierCount } from '../../hooks/useRcCreatedVerifierCount';
import { fetchRcVerifierUsers } from '../../lib/rcVerifierMembers';
import {
  allotGasSerialsToVerifier,
  clearGasSerialsForVerifier,
  rcOvUsedFromRecords,
} from '../../lib/rcMasterQuota';
import { pasProductIdSet } from '../../lib/pasSerialBank';
import { roleCanOpenVrAllotted } from '../../lib/roleNav';
import { filterGasAllottedChoices, serialInChoiceList } from '../../lib/serialEntryPool';
import {
  allottableVerifierSerials,
  vrAllottedStatus,
} from '../../lib/vrAllotted';
import { uniqueSerials } from '../../lib/yesoneInboundData';
import type { FirestoreUserDoc, SiteCalibration } from '../../types';

type StatusFilter = 'all' | 'unused' | 'used';

const CHIP_PREVIEW = 24;

function displayQty(value: number): string {
  return String(value);
}

function verifierLabel(user: FirestoreUserDoc & { uid: string }): string {
  return (user.username || user.aadhar || user.uid).trim().toUpperCase();
}

export const VrAllotted: React.FC = () => {
  const { user } = useAuth();
  const { products } = useAppContext();
  const rcUid = user?.role === 'rc_admin' ? user.uid : null;
  const roster = useRcCreatedVerifierCount(rcUid);
  const canOpen = roleCanOpenVrAllotted(user?.role, roster.count > 0);
  const confirm = useConfirm();

  const [verifiers, setVerifiers] = useState<Array<FirestoreUserDoc & { uid: string }>>([]);
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedUid, setSelectedUid] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [queryText, setQueryText] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [verifierFilter, setVerifierFilter] = useState('all');
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
      setSelectedUid(prev => prev || rows[0]?.uid || '');
    } catch {
      setVerifiers([]);
      setListError('Could not load verifiers.');
    } finally {
      setLoading(false);
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

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (filterRef.current?.contains(event.target as Node)) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  useLayoutEffect(() => {
    setFilterSlots({
      mobile: document.getElementById('verification-filter-slot-mobile'),
      desktop: document.getElementById('verification-filter-slot-desktop'),
    });
  }, []);

  const usedSerials = useMemo(
    () => rcOvUsedFromRecords(records, { pasProductIds }).serials,
    [pasProductIds, records],
  );

  const rosterUids = useMemo(() => verifiers.map(row => row.uid), [verifiers]);

  const status = useMemo(
    () =>
      vrAllottedStatus({
        allottedByUid: seats.allottedByUid,
        usedSerials,
        voidedSerials: seats.voidedSerials,
        verifierUids: rosterUids,
      }),
    [rosterUids, seats.allottedByUid, seats.voidedSerials, usedSerials],
  );

  const selectedRow = status.rows.find(row => row.uid === selectedUid);
  const allottable = useMemo(
    () =>
      selectedUid
        ? allottableVerifierSerials({
            remaining: seats.remaining,
            allottedByUid: seats.allottedByUid,
            verifierUid: selectedUid,
            rosterUids,
          })
        : [],
    [rosterUids, seats.allottedByUid, seats.remaining, selectedUid],
  );

  const unusedMineKey = (selectedRow?.unusedSerials ?? []).join('|');

  useEffect(() => {
    setPicked(unusedMineKey ? unusedMineKey.split('|') : []);
    setQueryText('');
  }, [selectedUid, unusedMineKey]);

  const hits = useMemo(
    () => filterGasAllottedChoices(allottable, queryText),
    [allottable, queryText],
  );
  const preview = hits.slice(0, CHIP_PREVIEW);
  const extra = Math.max(0, hits.length - preview.length);

  const filteredRows = useMemo(() => {
    return status.rows.filter(row => {
      if (verifierFilter !== 'all' && row.uid !== verifierFilter) return false;
      if (statusFilter === 'unused') return row.unused > 0;
      if (statusFilter === 'used') return row.used > 0;
      return true;
    });
  }, [status.rows, statusFilter, verifierFilter]);

  const filterActive = statusFilter !== 'all' || verifierFilter !== 'all';
  const names = useMemo(
    () => new Map(verifiers.map(row => [row.uid, verifierLabel(row)])),
    [verifiers],
  );

  const toggleSerial = (serial: string) => {
    setPicked(prev => {
      if (serialInChoiceList(serial, prev)) {
        return prev.filter(item => item.trim().toUpperCase() !== serial.trim().toUpperCase());
      }
      return uniqueSerials([...prev, serial]);
    });
  };

  const handleSave = async () => {
    if (!rcUid || !selectedUid || saving) return;
    setSaveError('');
    setSaving(true);
    try {
      const currentUnused = selectedRow?.unusedSerials ?? [];
      const pickedKeys = new Set(picked.map(serial => serial.trim().toUpperCase()));
      const removeSerials = currentUnused.filter(
        serial => !pickedKeys.has(serial.trim().toUpperCase()),
      );
      await allotGasSerialsToVerifier({
        rcUid,
        verifierUid: selectedUid,
        addSerials: picked,
        removeSerials,
        allowedSerials: seats.remaining,
      });
    } catch {
      setSaveError('Could not save allotted serials.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAll = async () => {
    if (!rcUid || !selectedUid || saving) return;
    const name = names.get(selectedUid) || 'this verifier';
    const count = selectedRow?.allotted ?? uniqueSerials(seats.allottedByUid[selectedUid] || []).length;
    if (count === 0) return;
    const ok = await confirm({
      title: 'Remove all allotted serials?',
      message: `Unallot all ${count} serials from ${name}? Used and unused seats return to the unused pool. Other verifiers are not changed.`,
      confirmLabel: 'Remove all',
      destructive: true,
    });
    if (!ok) return;
    setSaveError('');
    setSaving(true);
    try {
      await clearGasSerialsForVerifier(rcUid, selectedUid);
      setPicked([]);
    } catch {
      setSaveError('Could not remove allotted serials.');
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
        aria-label="Filter Vr Allotted"
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
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as StatusFilter)}
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
            value={verifierFilter}
            onChange={event => setVerifierFilter(event.target.value)}
          >
            <option value="all">All</option>
            {verifiers.map(row => (
              <option key={row.uid} value={row.uid}>
                {verifierLabel(row)}
              </option>
            ))}
          </select>
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

  return (
    <div className="fade-in page-content vr-allotted-page">
      {filterSlot ? createPortal(filterControl, filterSlot) : null}

      <div className="rc-summary-row">
        <article className="rc-summary-tile rc-summary-tile--blue">
          <p className="rc-summary-tile__label">
            <Layers size={16} strokeWidth={2.2} aria-hidden />
            Allotted
          </p>
          <p className="rc-summary-tile__value">{displayQty(status.totals.allotted)}</p>
        </article>
        <article className="rc-summary-tile rc-summary-tile--pink">
          <p className="rc-summary-tile__label">
            <CircleDot size={16} strokeWidth={2.2} aria-hidden />
            Used
          </p>
          <p className="rc-summary-tile__value">{displayQty(status.totals.used)}</p>
        </article>
        <article className="rc-summary-tile rc-summary-tile--green">
          <p className="rc-summary-tile__label">
            <Hash size={16} strokeWidth={2.2} aria-hidden />
            Unused
          </p>
          <p className="rc-summary-tile__value">{displayQty(status.totals.unused)}</p>
        </article>
      </div>

      <section className="panel glass vr-allotted-panel">
        <div className="panel-header">
          <h2>Allot serials</h2>
          {!filterSlot ? filterControl : null}
        </div>
        <div className="panel-body">
          {listError ? <p className="login-error">{listError}</p> : null}
          {saveError ? <p className="login-error">{saveError}</p> : null}
          {loading || !seats.ready ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="vr-allotted-pick-verifier">Verifier</label>
                <select
                  id="vr-allotted-pick-verifier"
                  value={selectedUid}
                  onChange={event => setSelectedUid(event.target.value)}
                  disabled={saving || verifiers.length === 0}
                >
                  {verifiers.map(row => (
                    <option key={row.uid} value={row.uid}>
                      {verifierLabel(row)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="vr-allotted-serial-search">Unused GAS serials</label>
                <div className="gas-serial-search-control vr-allotted-search">
                  <Search size={16} aria-hidden />
                  <input
                    id="vr-allotted-serial-search"
                    className="gas-serial-search-input"
                    type="search"
                    autoComplete="off"
                    placeholder={
                      allottable.length === 0
                        ? 'No unused allotted serials left'
                        : 'Search allotted serial'
                    }
                    value={queryText}
                    onChange={event => setQueryText(event.target.value)}
                    disabled={saving || allottable.length === 0}
                  />
                </div>
                {picked.length > 0 ? (
                  <ul className="vr-allotted-picked">
                    {picked.map(serial => (
                      <li key={serial}>
                        <button
                          type="button"
                          className="admin-setting-serial-seat admin-setting-serial-seat--picked text-mono"
                          onClick={() => toggleSerial(serial)}
                          disabled={saving}
                        >
                          {serial}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted text-sm">No unused seats allotted to this verifier.</p>
                )}
                {allottable.length > 0 ? (
                  <ul className="admin-setting-serial-seats ov-self-allotted-grid">
                    {preview.map(serial => {
                      const on = serialInChoiceList(serial, picked);
                      return (
                        <li key={serial}>
                          <button
                            type="button"
                            className={`admin-setting-serial-seat text-mono${
                              on ? ' admin-setting-serial-seat--picked' : ''
                            }`}
                            aria-pressed={on}
                            disabled={saving}
                            onClick={() => toggleSerial(serial)}
                          >
                            {serial}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {extra > 0 ? (
                  <p className="ov-self-serial-hint ov-self-serial-hint--muted" role="status">
                    {extra} more — type to search.
                  </p>
                ) : null}
              </div>
              <div className="vr-allotted-save">
                <button
                  type="button"
                  className="btn btn-danger flex items-center gap-2"
                  onClick={() => void handleRemoveAll()}
                  disabled={saving || !selectedUid || (selectedRow?.allotted ?? 0) === 0}
                >
                  <Trash2 size={16} />
                  Remove all
                </button>
                <button
                  type="button"
                  className="btn btn-primary flex items-center gap-2"
                  onClick={() => void handleSave()}
                  disabled={saving || !selectedUid}
                >
                  {saving ? <span className="spinner-inline" /> : <Save size={16} />}
                  Save allotment
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel glass vr-allotted-panel">
        <div className="panel-header">
          <h2>Status</h2>
        </div>
        <div className="panel-body table-scroll-wrap">
          {filteredRows.length === 0 ? (
            <p className="text-muted text-sm">No verifiers match this filter.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Verifier</th>
                  <th>Allotted</th>
                  <th>Used</th>
                  <th>Unused</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr
                    key={row.uid}
                    className={row.uid === selectedUid ? 'vr-allotted-row--active' : undefined}
                    onClick={() => setSelectedUid(row.uid)}
                  >
                    <td>{names.get(row.uid) || row.uid}</td>
                    <td className="text-mono">{row.allotted}</td>
                    <td className="text-mono">{row.used}</td>
                    <td className="text-mono">{row.unused}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
};
