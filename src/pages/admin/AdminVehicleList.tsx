import React, { useState, useEffect, useCallback } from 'react';
import { collection, deleteDoc, doc, getDocs, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { isVehicleActive, vehicleActiveLabel } from '../../lib/vehicleApproval';
import {
  formatValidityDate,
  formatVehicleDisplayDate,
  validityStatus,
  vehicleDocMetaFromRecord,
  vehiclePhotoFromRecord,
  VEHICLE_DOC_KEYS,
  VEHICLE_DOC_LABELS,
} from '../../lib/vehicleProfileFields';
import {
  Building2, RefreshCw, Trash2, Eye, X, ExternalLink, ImageIcon, UserX, UserCheck,
  Calendar, ShieldCheck, Check,
} from 'lucide-react';
import { VehicleLogoMark } from '../../components/VehicleLogoMark';
import {
  RcListCardActions,
  RcListCardToggle,
  RcListEditHint,
  RcListMetaChip,
  RcListPhoto,
  RcListStatusBadge,
} from '../../components/RcListCard';
import type { FirestoreUserDoc, Vehicle } from '../../types';

interface VehicleRecord extends Vehicle {
  rcCenterName: string;
}

const VALIDITY_LABEL: Record<ReturnType<typeof validityStatus>, string> = {
  ok: 'Valid',
  due: 'Due soon',
  expired: 'Expired',
  missing: 'Incomplete',
};

function vehicleTitle(record: Vehicle): string {
  return `${record.brand} ${record.model}`.trim().toUpperCase() || 'VEHICLE';
}

function VehicleDateStat({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: ReturnType<typeof validityStatus>;
}) {
  return (
    <div className="rc-vehicle-date-stat">
      <span className="rc-vehicle-date-stat-icon" aria-hidden>
        {icon}
      </span>
      <span className="rc-vehicle-date-stat-label">{label}</span>
      <span className="rc-vehicle-date-stat-value">{value}</span>
      <span className={`rc-vehicle-date-stat-line rc-vehicle-date-stat-line--${status}`} aria-hidden />
    </div>
  );
}

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
          <div className="stat-icon text-green"><VehicleLogoMark size="sm" /></div>
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
        <div className="rc-list-page">
          <section className="rc-vehicles-summary-card">
            <div className="rc-vehicles-summary-leading">
              <VehicleLogoMark size="md" />
              <h2 className="rc-vehicles-summary-title">Vehicles</h2>
              <p className="rc-vehicles-summary-sub">
                {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} · {inactiveCount} inactive
              </p>
            </div>
            <div className="rc-vehicles-summary-actions">
              <button
                type="button"
                className="rc-vehicles-refresh-btn"
                onClick={() => void fetchVehicles()}
                title="Refresh"
                aria-label="Refresh vehicles"
                disabled={loading}
              >
                <RefreshCw size={18} className={loading ? 'spinner-inline' : undefined} />
              </button>
            </div>
          </section>

          {loading ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : vehicles.length === 0 ? (
            <div className="rc-vehicles-empty">
              <VehicleLogoMark size="lg" />
              <p>No vehicles registered yet.</p>
            </div>
          ) : (
            <div className="rc-list-cards">
              {vehicles.map(v => {
                const docStatus = earliestValidity(v);
                const active = isVehicleActive(v);
                const rcStatus = validityStatus(v.rcValidity);
                const insuranceStatus = validityStatus(v.insuranceValidity);
                const photo = vehiclePhotoFromRecord(v);
                const label = v.regNumber || `${v.brand} ${v.model}`.trim() || 'vehicle';
                const plate = v.regNumber?.trim();

                return (
                  <article key={v.id} className="rc-list-card">
                    <div className="rc-list-card-top">
                      <button
                        type="button"
                        className="rc-list-card-main"
                        onClick={() => setReviewing(v)}
                        aria-label={`View ${label}`}
                      >
                        <RcListPhoto
                          url={photo?.url}
                          path={photo?.path}
                          placeholder={<VehicleLogoMark size="sm" variant="plain" />}
                        />
                        <span className="rc-list-card-info">
                          <span className="rc-list-card-name-row">
                            <span className="rc-list-card-name">{vehicleTitle(v)}</span>
                            <RcListEditHint />
                          </span>
                          <span className="rc-list-meta-chips">
                            <RcListMetaChip icon={<Building2 size={13} strokeWidth={2} />}>
                              {v.rcCenterName}
                            </RcListMetaChip>
                            {plate ? (
                              <RcListMetaChip icon={<span className="rc-vehicle-plate-ind">IND</span>}>
                                {plate}
                              </RcListMetaChip>
                            ) : null}
                            {v.year?.trim() && (
                              <RcListMetaChip icon={<Calendar size={13} strokeWidth={2} />}>
                                {v.year}
                              </RcListMetaChip>
                            )}
                          </span>
                          <span className="rc-list-card-badges">
                            <RcListStatusBadge
                              tone={active ? 'active' : 'inactive'}
                              label={vehicleActiveLabel(v.active)}
                              icon={<Check size={12} strokeWidth={2.75} aria-hidden />}
                            />
                            <RcListStatusBadge
                              tone={docStatus}
                              label={VALIDITY_LABEL[docStatus]}
                              icon={<ShieldCheck size={12} strokeWidth={2.5} aria-hidden />}
                            />
                          </span>
                        </span>
                      </button>
                      <RcListCardActions>
                        <RcListCardToggle
                          className="rc-list-card-toggle--view"
                          onClick={() => setReviewing(v)}
                          title="View vehicle"
                          ariaLabel={`View ${label}`}
                        >
                          <Eye size={18} strokeWidth={1.75} />
                        </RcListCardToggle>
                        <RcListCardToggle
                          className={active ? '' : 'rc-list-card-toggle--enable'}
                          onClick={() => void handleToggleActive(v)}
                          title={active ? 'Disable vehicle' : 'Enable vehicle'}
                          ariaLabel={active ? `Disable ${label}` : `Enable ${label}`}
                        >
                          {active ? <UserX size={18} strokeWidth={1.75} /> : <UserCheck size={18} strokeWidth={1.75} />}
                        </RcListCardToggle>
                        <RcListCardToggle
                          className="rc-list-card-toggle--delete"
                          onClick={() => void handleDelete(v.id, label)}
                          title="Remove vehicle"
                          ariaLabel={`Remove ${label}`}
                        >
                          <Trash2 size={18} strokeWidth={1.85} />
                        </RcListCardToggle>
                      </RcListCardActions>
                    </div>

                    <div className="rc-vehicle-card-divider" aria-hidden />

                    <div className="rc-vehicle-card-dates">
                      <VehicleDateStat
                        icon={<Calendar size={16} strokeWidth={1.75} />}
                        label="RC Validity"
                        value={formatVehicleDisplayDate(v.rcValidity)}
                        status={rcStatus}
                      />
                      <VehicleDateStat
                        icon={<ShieldCheck size={16} strokeWidth={1.75} />}
                        label="Insurance Valid Till"
                        value={formatVehicleDisplayDate(v.insuranceValidity)}
                        status={insuranceStatus}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
