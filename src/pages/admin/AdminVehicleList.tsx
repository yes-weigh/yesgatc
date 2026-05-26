import React, { useState, useEffect, useCallback } from 'react';
import { collection, deleteDoc, doc, getDocs, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { isVehicleActive, vehicleActiveLabel } from '../../lib/vehicleApproval';
import {
  formatValidityDate,
  validityStatus,
  vehicleDocMetaFromRecord,
  VEHICLE_DOC_KEYS,
  VEHICLE_DOC_LABELS,
} from '../../lib/vehicleProfileFields';
import {
  Truck, Building2, RefreshCw, Trash2, Eye, X, ExternalLink, ImageIcon, UserX, UserCheck,
} from 'lucide-react';
import type { FirestoreUserDoc, Vehicle } from '../../types';

interface VehicleRecord extends Vehicle {
  rcCenterName: string;
}

const VALIDITY_BADGE: Record<ReturnType<typeof validityStatus>, string> = {
  ok: 'vehicle-validity-ok',
  due: 'vehicle-validity-due',
  expired: 'vehicle-validity-expired',
  missing: 'vehicle-validity-missing',
};

function earliestValidity(v: Vehicle) {
  const dates = [v.rcValidity, v.insuranceValidity, v.pollutionValidity, v.f2WeightValidity];
  return dates.map(validityStatus).sort((a, b) => {
    const order = { expired: 0, due: 1, missing: 2, ok: 3 };
    return order[a] - order[b];
  })[0];
}

export const AdminVehicleList: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<VehicleRecord | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchVehicles = useCallback(async () => {
    setLoading(true);
    const [vehicleSnap, userSnap] = await Promise.all([
      getDocs(collection(db, 'vehicles')),
      getDocs(collection(db, 'users')),
    ]);

    const rcByUid = new Map<string, string>();
    userSnap.docs.forEach(d => {
      const data = d.data() as FirestoreUserDoc;
      if (data.role === 'rc_admin') {
        rcByUid.set(d.id, data.companyName || data.username || '—');
      }
    });

    const rows: VehicleRecord[] = vehicleSnap.docs.map(d => {
      const data = d.data() as Omit<Vehicle, 'id'>;
      return {
        id: d.id,
        ...data,
        rcCenterName: (data.rcId && rcByUid.get(data.rcId)) || '—',
      };
    });

    rows.sort((a, b) =>
      a.rcCenterName.localeCompare(b.rcCenterName)
        || (b.createdAt || '').localeCompare(a.createdAt || ''),
    );

    setVehicles(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchVehicles());
  }, [fetchVehicles]);

  const inactiveCount = vehicles.filter(v => !isVehicleActive(v)).length;

  const handleDelete = async (id: string, label: string) => {
    const ok = await confirm({
      title: 'Remove vehicle?',
      message: `Remove vehicle "${label}"?\nThis cannot be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    try {
      await deleteDoc(doc(db, 'vehicles', id));
      if (reviewing?.id === id) setReviewing(null);
      await fetchVehicles();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove vehicle.');
    }
  };

  const handleToggleActive = async (vehicle: VehicleRecord) => {
    const activating = !isVehicleActive(vehicle);
    const label = vehicle.regNumber || `${vehicle.brand} ${vehicle.model}`.trim() || 'vehicle';
    const ok = await confirm({
      title: activating ? 'Enable vehicle?' : 'Disable vehicle?',
      message: activating
        ? `Enable "${label}" for use again?`
        : `Disable "${label}"? It will not be available for assignment while inactive.`,
      confirmLabel: activating ? 'Enable' : 'Disable',
      destructive: !activating,
    });
    if (!ok || !user?.uid) return;

    setToggling(true);
    try {
      const updates: Record<string, unknown> = activating
        ? { active: true, deactivatedAt: deleteField(), deactivatedByUid: deleteField() }
        : {
            active: false,
            deactivatedAt: new Date().toISOString(),
            deactivatedByUid: user.uid,
          };

      await updateDoc(doc(db, 'vehicles', vehicle.id), updates);
      if (reviewing?.id === vehicle.id) {
        setReviewing(prev => (prev ? { ...prev, active: activating } : null));
      }
      await fetchVehicles();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update vehicle status.');
    } finally {
      setToggling(false);
    }
  };

  const renderDocLink = (label: string, url?: string) => (
    url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="vct-review-doc-link">
        <ExternalLink size={14} /> {label}
      </a>
    ) : (
      <span className="text-muted text-sm">Not uploaded</span>
    )
  );

  return (
    <div className="fade-in page-content">
      <div className="stats-grid mb-6">
        <div className="stat-card glass">
          <div className="stat-icon text-green"><Truck /></div>
          <div className="stat-content">
            <h3>Vehicles</h3>
            <p className="stat-value">{vehicles.length}</p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-blue"><Building2 /></div>
          <div className="stat-content">
            <h3>Regional centers represented</h3>
            <p className="stat-value">
              {new Set(vehicles.map(v => v.rcId).filter(Boolean)).size}
            </p>
          </div>
        </div>
        <div className="stat-card glass">
          <div className="stat-icon text-orange"><UserX /></div>
          <div className="stat-content">
            <h3>Inactive</h3>
            <p className="stat-value">{inactiveCount}</p>
          </div>
        </div>
      </div>

      {reviewing && (
        <InlineFormPanel id="vehicle-review" className="mb-6 inline-form-panel--wide inline-form-panel--vehicle">
          <div className="product-form-panel">
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="vehicle-review-title">
                  <Eye className="inline-icon" /> Vehicle Details
                </h2>
                <p className="text-muted text-sm mb-0">
                  {reviewing.brand} {reviewing.model} · {reviewing.regNumber || '—'}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                onClick={() => setReviewing(null)}
                disabled={toggling}
              >
                <X size={15} /> Close
              </button>
            </div>

            <div className="product-form-body vct-review-body">
              <div className="vct-review-profile">
                {reviewing.vehiclePhotoUrl ? (
                  <img
                    src={reviewing.vehiclePhotoUrl}
                    alt={`${reviewing.brand} ${reviewing.model}`}
                    className="vct-review-avatar"
                  />
                ) : (
                  <span className="vct-review-avatar vct-review-avatar--placeholder">
                    <ImageIcon size={40} />
                  </span>
                )}
                <div>
                  <p className="vct-review-profile-name">
                    {reviewing.brand} {reviewing.model}
                  </p>
                  <p className="text-muted text-sm text-mono">{reviewing.regNumber || '—'}</p>
                </div>
              </div>

              <div className="vct-review-grid">
                <div><span className="vct-review-label">Regional Center</span><p>{reviewing.rcCenterName}</p></div>
                <div><span className="vct-review-label">Status</span><p>{vehicleActiveLabel(reviewing.active)}</p></div>
                <div><span className="vct-review-label">Year</span><p>{reviewing.year || '—'}</p></div>
                <div><span className="vct-review-label">RC validity</span><p>{formatValidityDate(reviewing.rcValidity)}</p></div>
                <div><span className="vct-review-label">Insurance</span><p>{formatValidityDate(reviewing.insuranceValidity)}</p></div>
                <div><span className="vct-review-label">Pollution</span><p>{formatValidityDate(reviewing.pollutionValidity)}</p></div>
                <div><span className="vct-review-label">F2 weight</span><p>{formatValidityDate(reviewing.f2WeightValidity)}</p></div>
              </div>

              <div className="vct-review-docs">
                <span className="vct-review-label">Documents</span>
                <div className="vct-review-doc-links">
                  {VEHICLE_DOC_KEYS.map(key => (
                    renderDocLink(VEHICLE_DOC_LABELS[key].label, vehicleDocMetaFromRecord(reviewing, key)?.url)
                  ))}
                </div>
              </div>
            </div>

            <div className="product-form-footer">
              <button
                type="button"
                className={`btn flex items-center gap-2 ${isVehicleActive(reviewing) ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => handleToggleActive(reviewing)}
                disabled={toggling}
              >
                {toggling ? (
                  <span className="spinner-inline"></span>
                ) : isVehicleActive(reviewing) ? (
                  <>
                    <UserX size={18} /> Disable Vehicle
                  </>
                ) : (
                  <>
                    <UserCheck size={18} /> Enable Vehicle
                  </>
                )}
              </button>
            </div>
          </div>
        </InlineFormPanel>
      )}

      {!reviewing && (
        <div className="panel glass panel--table mb-6">
          <div className="panel-header justify-between">
            <div>
              <h2>
                <Truck className="inline-icon" /> Vehicles
              </h2>
              <p className="text-muted text-sm mt-1">
                Vehicles registered by regional centers. Enable or disable as needed.
              </p>
            </div>
            <button className="btn-icon" onClick={fetchVehicles} title="Refresh" type="button">
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="panel-body p-0">
            {loading ? (
              <div className="flex justify-center py-16">
                <span className="spinner-inline large"></span>
              </div>
            ) : (
              <div className="table-scroll-wrap">
                <table className="data-table data-table--vehicles-rc data-table--vehicles-admin data-table--mobile-cards">
                  <thead>
                    <tr>
                      <th className="vehicle-rc-col-serial">#</th>
                      <th>Vehicle</th>
                      <th className="vehicle-admin-col-rc">Regional Center</th>
                      <th>Reg number</th>
                      <th>Year</th>
                      <th>RC validity</th>
                      <th>Insurance</th>
                      <th>Pollution</th>
                      <th>F2 weight</th>
                      <th>Active</th>
                      <th>Docs</th>
                      <th className="text-right vehicle-rc-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v, index) => {
                      const docStatus = earliestValidity(v);
                      const active = isVehicleActive(v);

                      return (
                        <tr key={v.id} className="table-mobile-row table-mobile-row--actions">
                          <td className="vehicle-rc-col-serial text-muted text-sm table-mobile-col-hide">{index + 1}</td>
                          <td className="font-medium table-mobile-col-primary">
                            <div className="flex items-center gap-2 min-w-0">
                              {v.vehiclePhotoUrl ? (
                                <img src={v.vehiclePhotoUrl} alt="" className="vct-table-avatar shrink-0" />
                              ) : (
                                <span className="vct-table-avatar vct-table-avatar--placeholder shrink-0">
                                  <ImageIcon size={18} />
                                </span>
                              )}
                              <div className="min-w-0">
                                <span className="table-mobile-primary-text">
                                  {v.brand} {v.model}
                                </span>
                                <div className="table-mobile-summary">
                                  <span className="table-mobile-summary-meta">{v.rcCenterName}</span>
                                  <span className="text-mono">{v.regNumber || '—'} · {v.year || '—'}</span>
                                  <span className="table-mobile-summary-badges">
                                    <span
                                      className={`status-badge ${active ? 'vct-status-active' : 'vct-status-inactive'}`}
                                    >
                                      {vehicleActiveLabel(v.active)}
                                    </span>
                                    <span className={`status-badge ${VALIDITY_BADGE[docStatus]}`}>
                                      {docStatus === 'ok' && 'Valid'}
                                      {docStatus === 'due' && 'Due soon'}
                                      {docStatus === 'expired' && 'Expired'}
                                      {docStatus === 'missing' && 'Incomplete'}
                                    </span>
                                  </span>
                                  <span className="table-mobile-summary-meta text-sm">
                                    RC {formatValidityDate(v.rcValidity)} · Ins {formatValidityDate(v.insuranceValidity)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="vehicle-admin-col-rc table-cell-truncate table-mobile-col-hide" title={v.rcCenterName}>
                            {v.rcCenterName}
                          </td>
                          <td className="text-sm text-mono table-mobile-col-hide">{v.regNumber || '—'}</td>
                          <td className="text-sm table-mobile-col-hide">{v.year || '—'}</td>
                          <td className="text-sm table-mobile-col-hide">{formatValidityDate(v.rcValidity)}</td>
                          <td className="text-sm table-mobile-col-hide">{formatValidityDate(v.insuranceValidity)}</td>
                          <td className="text-sm table-mobile-col-hide">{formatValidityDate(v.pollutionValidity)}</td>
                          <td className="text-sm table-mobile-col-hide">{formatValidityDate(v.f2WeightValidity)}</td>
                          <td className="table-mobile-col-hide">
                            <span
                              className={`status-badge ${active ? 'vct-status-active' : 'vct-status-inactive'}`}
                            >
                              {vehicleActiveLabel(v.active)}
                            </span>
                          </td>
                          <td className="table-mobile-col-hide">
                            <span className={`status-badge ${VALIDITY_BADGE[docStatus]}`}>
                              {docStatus === 'ok' && 'Valid'}
                              {docStatus === 'due' && 'Due soon'}
                              {docStatus === 'expired' && 'Expired'}
                              {docStatus === 'missing' && 'Incomplete'}
                            </span>
                          </td>
                          <td className="text-right vehicle-rc-col-actions table-mobile-col-actions">
                            <button
                              type="button"
                              className="btn-icon text-blue mr-2"
                              onClick={() => setReviewing(v)}
                              title="View vehicle"
                            >
                              <Eye size={18} />
                            </button>
                            <button
                              type="button"
                              className={`btn-icon mr-2 ${active ? 'text-amber' : 'text-green'}`}
                              onClick={() => handleToggleActive(v)}
                              title={active ? 'Disable vehicle' : 'Enable vehicle'}
                            >
                              {active ? <UserX size={18} /> : <UserCheck size={18} />}
                            </button>
                            <button
                              type="button"
                              className="btn-icon text-red"
                              onClick={() => handleDelete(v.id, v.regNumber || `${v.brand} ${v.model}`)}
                              title="Remove"
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {vehicles.length === 0 && (
                      <tr>
                        <td colSpan={12} className="text-center py-10 text-muted">
                          No vehicles registered yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
