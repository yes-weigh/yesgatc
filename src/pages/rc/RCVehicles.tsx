import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, getDocs, doc, setDoc, updateDoc, query, where, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { VehicleLogoMark } from '../../components/VehicleLogoMark';
import {
  RcListCardToggle,
  RcListEditHint,
  RcListMetaChip,
  RcListPhoto,
  RcListStatusBadge,
} from '../../components/RcListCard';
import { uploadVehicleDocument, type VehicleDocKind } from '../../lib/vehicleDocumentUpload';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import {
  buildVehicleProfileFields,
  formatVehicleDisplayDate,
  requireVehicleDocuments,
  validateVehicleProfile,
  validityStatus,
  vehicleDocFieldsFromMeta,
  vehicleDocsFromRecord,
  vehiclePhotoFieldsFromMeta,
  vehiclePhotoFromRecord,
  VEHICLE_DOC_KEYS,
  type VehicleDocKey,
} from '../../lib/vehicleProfileFields';
import {
  Calendar,
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react';
import { isVehicleActive, vehicleActiveLabel } from '../../lib/vehicleApproval';
import type { Vehicle } from '../../types';
import {
  EMPTY_VEHICLE_DOC_STATE,
  EMPTY_VEHICLE_FORM,
  VehicleFormFields,
  type VehicleDocUploadState,
  type VehicleFormValues,
} from './VehicleFormFields';

const DOC_KIND_MAP: Record<VehicleDocKey, VehicleDocKind> = {
  rcDoc: 'rc',
  insuranceDoc: 'insurance',
  pollutionDoc: 'pollution',
  f2WeightDoc: 'f2-weight',
};

const EMPTY_DOC_UPLOADS = (): Record<VehicleDocKey, VehicleDocUploadState> => ({
  rcDoc: { ...EMPTY_VEHICLE_DOC_STATE },
  insuranceDoc: { ...EMPTY_VEHICLE_DOC_STATE },
  pollutionDoc: { ...EMPTY_VEHICLE_DOC_STATE },
  f2WeightDoc: { ...EMPTY_VEHICLE_DOC_STATE },
});

function docUploadsFromVehicle(record: Vehicle): Record<VehicleDocKey, VehicleDocUploadState> {
  const docs = vehicleDocsFromRecord(record);
  return {
    rcDoc: { ...EMPTY_VEHICLE_DOC_STATE, file: docs.rcDoc },
    insuranceDoc: { ...EMPTY_VEHICLE_DOC_STATE, file: docs.insuranceDoc },
    pollutionDoc: { ...EMPTY_VEHICLE_DOC_STATE, file: docs.pollutionDoc },
    f2WeightDoc: { ...EMPTY_VEHICLE_DOC_STATE, file: docs.f2WeightDoc },
  };
}

function vehicleFormFromRecord(record: Vehicle): VehicleFormValues {
  return {
    brand: record.brand || '',
    model: record.model || '',
    year: record.year || '',
    regNumber: record.regNumber || '',
    rcValidity: record.rcValidity || '',
    insuranceValidity: record.insuranceValidity || '',
    pollutionValidity: record.pollutionValidity || '',
    f2WeightValidity: record.f2WeightValidity || '',
  };
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

export const RCVehicles: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<VehicleFormValues>(EMPTY_VEHICLE_FORM);
  const [docUploads, setDocUploads] = useState<Record<VehicleDocKey, VehicleDocUploadState>>(EMPTY_DOC_UPLOADS);
  const [pendingDocs, setPendingDocs] = useState<Partial<Record<VehicleDocKey, File>>>({});
  const [vehiclePhoto, setVehiclePhoto] = useState<VehicleDocUploadState>({ ...EMPTY_VEHICLE_DOC_STATE });
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');

  const fetchVehicles = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setListError('');
    try {
      const q = query(collection(db, 'vehicles'), where('rcId', '==', user.uid));
      const snap = await getDocs(q);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Vehicle, 'id'>) }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setVehicles(rows);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'permission-denied') {
        setListError(
          'Could not load vehicles. Deploy Firestore rules: firebase deploy --only firestore:rules,storage',
        );
      } else {
        setListError(err instanceof Error ? err.message : 'Failed to load vehicles.');
      }
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    Promise.resolve().then(() => fetchVehicles());
  }, [fetchVehicles]);

  const showForm = showAddForm || editingId !== null;
  const formBusy = submitting;

  const resetDocs = () => {
    setDocUploads(EMPTY_DOC_UPLOADS());
    setPendingDocs({});
    setVehiclePhoto({ ...EMPTY_VEHICLE_DOC_STATE });
    setPendingPhoto(null);
    setPhotoRemoved(false);
  };

  const resetForm = () => {
    setFormValues(EMPTY_VEHICLE_FORM);
    resetDocs();
    setError('');
  };

  const handleCloseForm = () => {
    if (formBusy) return;
    setShowAddForm(false);
    setEditingId(null);
    resetForm();
  };

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !formBusy) handleCloseForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, formBusy]);

  const patchForm = (patch: Partial<VehicleFormValues>) => {
    setFormValues(prev => ({ ...prev, ...patch }));
  };

  const setDocState = (key: VehicleDocKey, patch: Partial<VehicleDocUploadState>) => {
    setDocUploads(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleDocSelect = (key: VehicleDocKey, file: File) => {
    setPendingDocs(prev => ({ ...prev, [key]: file }));
    const previewUrl = URL.createObjectURL(file);
    setDocState(key, {
      file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
      uploading: false,
      progress: 0,
    });
  };

  const handleDocRemove = (key: VehicleDocKey) => {
    setPendingDocs(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDocState(key, EMPTY_VEHICLE_DOC_STATE);
  };

  const handlePhotoSelect = (file: File) => {
    setPendingPhoto(file);
    setPhotoRemoved(false);
    const previewUrl = URL.createObjectURL(file);
    setVehiclePhoto({
      file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
      uploading: false,
      progress: 0,
    });
  };

  const handlePhotoRemove = () => {
    setPendingPhoto(null);
    setPhotoRemoved(true);
    setVehiclePhoto({ ...EMPTY_VEHICLE_DOC_STATE });
  };

  const docForValidation = (key: VehicleDocKey): ProductFileMeta | null => {
    if (pendingDocs[key]) {
      const file = pendingDocs[key]!;
      return { url: 'pending', path: '', name: file.name, contentType: file.type };
    }
    const state = docUploads[key];
    if (!state.file?.url) return null;
    return state.file;
  };

  const currentDocs = (): Record<VehicleDocKey, ProductFileMeta | null> =>
    Object.fromEntries(VEHICLE_DOC_KEYS.map(key => [key, docForValidation(key)])) as Record<
      VehicleDocKey,
      ProductFileMeta | null
    >;

  const validateForm = (): string | null => {
    const profileError = validateVehicleProfile(formValues);
    if (profileError) return profileError;
    return requireVehicleDocuments(currentDocs());
  };

  const uploadPendingDoc = async (vehicleId: string, key: VehicleDocKey): Promise<ProductFileMeta | null> => {
    const pending = pendingDocs[key];
    if (!pending) {
      const existing = docUploads[key].file;
      if (existing?.url && !existing.url.startsWith('blob:')) return existing;
      return null;
    }
    setDocState(key, { uploading: true, progress: 0 });
    try {
      const meta = await uploadVehicleDocument(vehicleId, DOC_KIND_MAP[key], pending, pct => {
        setDocState(key, { progress: pct });
      });
      setDocState(key, { file: meta, uploading: false, progress: 100 });
      return meta;
    } catch (err) {
      setDocState(key, { uploading: false, progress: 0 });
      throw err;
    }
  };

  const uploadPhoto = async (vehicleId: string): Promise<Partial<Vehicle>> => {
    if (photoRemoved && !pendingPhoto) return vehiclePhotoFieldsFromMeta(null);
    if (!pendingPhoto) {
      const existing = vehiclePhoto.file;
      if (existing?.url && !existing.url.startsWith('blob:')) {
        return vehiclePhotoFieldsFromMeta(existing);
      }
      return {};
    }
    setVehiclePhoto(prev => ({ ...prev, uploading: true, progress: 0 }));
    try {
      const meta = await uploadVehicleDocument(vehicleId, 'photo', pendingPhoto, pct => {
        setVehiclePhoto(prev => ({ ...prev, progress: pct }));
      });
      setVehiclePhoto({ file: meta, uploading: false, progress: 100 });
      return vehiclePhotoFieldsFromMeta(meta);
    } catch (err) {
      setVehiclePhoto(prev => ({ ...prev, uploading: false, progress: 0 }));
      throw err;
    }
  };

  const uploadAllDocs = async (vehicleId: string): Promise<Partial<Vehicle>> => {
    let fields: Partial<Vehicle> = {};
    for (const key of VEHICLE_DOC_KEYS) {
      const meta = await uploadPendingDoc(vehicleId, key);
      fields = { ...fields, ...vehicleDocFieldsFromMeta(key, meta) };
    }
    return fields;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showAddForm) await handleCreate();
    else if (editingId) await handleSaveEdit(editingId);
  };

  const handleCreate = async () => {
    setError('');
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const ref = doc(collection(db, 'vehicles'));
      const vehicleId = ref.id;
      const docFields = await uploadAllDocs(vehicleId);
      const photoFields = await uploadPhoto(vehicleId);

      const record: Omit<Vehicle, 'id'> = {
        rcId: user!.uid,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        active: true,
        ...buildVehicleProfileFields(formValues),
        ...docFields,
        ...photoFields,
      };
      await setDoc(ref, record);

      handleCloseForm();
      await fetchVehicles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add vehicle.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (vehicleId: string) => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const docFields = await uploadAllDocs(vehicleId);
      const photoFields = await uploadPhoto(vehicleId);

      const updates: Partial<Vehicle> = {
        ...buildVehicleProfileFields(formValues),
        ...docFields,
        ...photoFields,
      };

      await updateDoc(doc(db, 'vehicles', vehicleId), updates);
      handleCloseForm();
      await fetchVehicles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update vehicle.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAdd = () => {
    setEditingId(null);
    resetForm();
    setShowAddForm(true);
  };

  const startEdit = (v: Vehicle) => {
    setShowAddForm(false);
    setEditingId(v.id);
    setFormValues(vehicleFormFromRecord(v));
    setDocUploads(docUploadsFromVehicle(v));
    setPendingDocs({});
    setVehiclePhoto({
      ...EMPTY_VEHICLE_DOC_STATE,
      file: vehiclePhotoFromRecord(v),
    });
    setPendingPhoto(null);
    setPhotoRemoved(false);
    setError('');
  };

  const handleToggleActive = async (v: Vehicle) => {
    const activating = !isVehicleActive(v);
    const label = v.regNumber || `${v.brand} ${v.model}`.trim() || 'vehicle';
    const ok = await confirm({
      title: activating ? 'Enable vehicle?' : 'Disable vehicle?',
      message: activating
        ? `Enable "${label}" for use again?`
        : `Disable "${label}"? It will not be available for assignment while inactive.`,
      confirmLabel: activating ? 'Enable' : 'Disable',
      destructive: !activating,
    });
    if (!ok || !user?.uid) return;

    const updates: Record<string, unknown> = activating
      ? { active: true, deactivatedAt: deleteField(), deactivatedByUid: deleteField() }
      : {
          active: false,
          deactivatedAt: new Date().toISOString(),
          deactivatedByUid: user.uid,
        };

    await updateDoc(doc(db, 'vehicles', v.id), updates);
    await fetchVehicles();
  };

  const earliestValidity = (v: Vehicle) => {
    const dates = [v.rcValidity, v.insuranceValidity, v.pollutionValidity, v.f2WeightValidity];
    const status = dates.map(validityStatus).sort((a, b) => {
      const order = { expired: 0, due: 1, missing: 2, ok: 3 };
      return order[a] - order[b];
    })[0];
    return status;
  };

  return (
    <div className="fade-in page-content">
      {showForm && (
        <InlineFormPanel id="vehicle-form" className="mb-6 inline-form-panel--wide inline-form-panel--vehicle">
          <div className="product-form-panel">
            <ListViewBackBar onBack={handleCloseForm} disabled={formBusy} />
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="vehicle-form-title">
                  {showAddForm ? (
                    <>
                      <Plus className="inline-icon" /> Add Vehicle
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Vehicle
                    </>
                  )}
                </h2>
                <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                  {error || (showAddForm ? 'Vehicle is active immediately after registration.' : '\u00a0')}
                </p>
              </div>
            </div>

            <form onSubmit={handleFormSubmit} className="product-form" autoComplete="off" noValidate>
              <div className="product-form-body">
                <VehicleFormFields
                  mode={showAddForm ? 'create' : 'edit'}
                  values={formValues}
                  onChange={patchForm}
                  vehiclePhoto={vehiclePhoto}
                  onVehiclePhotoSelect={handlePhotoSelect}
                  onVehiclePhotoRemove={handlePhotoRemove}
                  docStates={docUploads}
                  onDocSelect={handleDocSelect}
                  onDocRemove={handleDocRemove}
                  submitting={formBusy}
                />
              </div>
              <div className="product-form-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseForm}
                  disabled={formBusy}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex items-center gap-2" disabled={formBusy}>
                  {formBusy ? (
                    <span className="spinner-inline"></span>
                  ) : showAddForm ? (
                    <>
                      <Plus size={16} /> Add Vehicle
                    </>
                  ) : (
                    <>
                      <Save size={18} /> Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </InlineFormPanel>
      )}

      {!showForm && (
        <div className="rc-vehicles-page">
          <section className="rc-vehicles-summary-card">
            <div className="rc-vehicles-summary-leading">
              <VehicleLogoMark size="md" />
              <h2 className="rc-vehicles-summary-title">Vehicles</h2>
              <p className="rc-vehicles-summary-sub">
                {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} registered
              </p>
            </div>
            <div className="rc-vehicles-summary-actions">
              <button
                type="button"
                className="rc-vehicles-add-btn"
                onClick={handleStartAdd}
                aria-label="Add Vehicle"
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="rc-vehicles-add-btn-label">Add Vehicle</span>
              </button>
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
          {listError && (
            <p className="rc-vehicles-summary-error" role="alert">
              {listError}
            </p>
          )}

          {loading ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : vehicles.length === 0 ? (
            <div className="rc-vehicles-empty">
              <VehicleLogoMark size="lg" />
              <p>No vehicles yet.</p>
              <button
                type="button"
                className="rc-vehicles-add-btn"
                onClick={handleStartAdd}
                aria-label="Add Vehicle"
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="rc-vehicles-add-btn-label">Add Vehicle</span>
              </button>
            </div>
          ) : (
            <div className="rc-list-cards">
              {vehicles.map(v => {
                const active = isVehicleActive(v);
                const overallValidity = earliestValidity(v);
                const rcStatus = validityStatus(v.rcValidity);
                const insuranceStatus = validityStatus(v.insuranceValidity);
                const photo = vehiclePhotoFromRecord(v);
                const disableLabel = v.regNumber || `${v.brand} ${v.model}`.trim() || 'vehicle';
                const plate = v.regNumber?.trim();

                return (
                  <article key={v.id} className="rc-list-card">
                    <div className="rc-list-card-top">
                      <button
                        type="button"
                        className="rc-list-card-main"
                        onClick={() => startEdit(v)}
                        aria-label={`Edit ${disableLabel}`}
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
                            {plate ? (
                              <RcListMetaChip icon={<span className="rc-vehicle-plate-ind">IND</span>}>
                                {plate}
                              </RcListMetaChip>
                            ) : (
                              <RcListMetaChip icon={<Calendar size={13} strokeWidth={2} />}>No plate</RcListMetaChip>
                            )}
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
                              tone={overallValidity}
                              label={VALIDITY_LABEL[overallValidity]}
                              icon={<ShieldCheck size={12} strokeWidth={2.5} aria-hidden />}
                            />
                          </span>
                        </span>
                      </button>
                      <RcListCardToggle
                        className={active ? '' : 'rc-list-card-toggle--enable'}
                        onClick={() => void handleToggleActive(v)}
                        title={active ? 'Disable vehicle' : 'Enable vehicle'}
                        ariaLabel={active ? `Disable ${disableLabel}` : `Enable ${disableLabel}`}
                      >
                        {active ? <UserX size={20} strokeWidth={1.75} /> : <UserCheck size={20} strokeWidth={1.75} />}
                      </RcListCardToggle>
                    </div>

                    <div className="rc-vehicle-card-divider" aria-hidden />

                    <div className="rc-vehicle-card-dates">
                      <VehicleDateStat
                        icon={<Calendar size={16} strokeWidth={1.75} />}
                        label="Registration Date"
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
