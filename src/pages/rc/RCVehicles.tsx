import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { uploadVehicleDocument, type VehicleDocKind } from '../../lib/vehicleDocumentUpload';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import {
  buildVehicleProfileFields,
  formatValidityDate,
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
  Truck, Trash2, RefreshCw, Pencil, X, Plus, Save, ImageIcon,
} from 'lucide-react';
import { vehicleApprovalLabel } from '../../lib/vehicleApproval';
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

const VALIDITY_BADGE: Record<ReturnType<typeof validityStatus>, string> = {
  ok: 'vehicle-validity-ok',
  due: 'vehicle-validity-due',
  expired: 'vehicle-validity-expired',
  missing: 'vehicle-validity-missing',
};

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
        approvalStatus: 'pending',
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

  const handleDelete = async (id: string, label: string) => {
    const ok = await confirm({
      title: 'Remove vehicle?',
      message: `Remove vehicle "${label}" from your centre?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await deleteDoc(doc(db, 'vehicles', id));
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
                  {error || (showAddForm ? 'Super Admin approval required before this vehicle is active.' : '\u00a0')}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                onClick={handleCloseForm}
                disabled={formBusy}
                aria-label="Close"
              >
                <X size={15} /> Close
              </button>
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
        <div className="panel glass panel--table mb-6">
          <div className="panel-header justify-between">
            <div>
              <h2>
                <Truck className="inline-icon" /> Vehicles
              </h2>
            <p className="text-muted text-sm mt-1">
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} registered
            </p>
            {listError && (
              <p className="rc-form-topbar-error text-sm mt-1" role="alert">
                {listError}
              </p>
            )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-primary flex items-center gap-1.5 text-sm py-1.5 px-3"
                onClick={handleStartAdd}
              >
                <Plus size={16} /> Add Vehicle
              </button>
              <button className="btn-icon" onClick={fetchVehicles} title="Refresh" type="button">
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
          <div className="panel-body p-0">
            {loading ? (
              <div className="flex justify-center py-16">
                <span className="spinner-inline large"></span>
              </div>
            ) : (
              <div className="table-scroll-wrap">
                <table className="data-table data-table--vehicles-rc">
                  <thead>
                    <tr>
                      <th className="vehicle-rc-col-serial">#</th>
                      <th>Vehicle</th>
                      <th>Reg number</th>
                      <th>Year</th>
                      <th>RC validity</th>
                      <th>Insurance</th>
                      <th>Pollution</th>
                      <th>F2 weight</th>
                      <th>Approval</th>
                      <th>Docs</th>
                      <th className="text-right vehicle-rc-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v, index) => {
                      const status = earliestValidity(v);
                      return (
                        <tr key={v.id}>
                          <td className="vehicle-rc-col-serial text-muted text-sm">{index + 1}</td>
                          <td className="font-medium">
                            <div className="flex items-center gap-2">
                              {v.vehiclePhotoUrl ? (
                                <img src={v.vehiclePhotoUrl} alt="" className="vct-table-avatar" />
                              ) : (
                                <span className="vct-table-avatar vct-table-avatar--placeholder">
                                  <ImageIcon size={18} />
                                </span>
                              )}
                              <span>
                                {v.brand} {v.model}
                              </span>
                            </div>
                          </td>
                          <td className="text-sm text-mono">{v.regNumber || '—'}</td>
                          <td className="text-sm">{v.year || '—'}</td>
                          <td className="text-sm">{formatValidityDate(v.rcValidity)}</td>
                          <td className="text-sm">{formatValidityDate(v.insuranceValidity)}</td>
                          <td className="text-sm">{formatValidityDate(v.pollutionValidity)}</td>
                          <td className="text-sm">{formatValidityDate(v.f2WeightValidity)}</td>
                          <td>
                            <span
                              className={`status-badge ${
                                v.approvalStatus === 'pending' ? 'vct-status-pending' : 'vct-status-approved'
                              }`}
                            >
                              {vehicleApprovalLabel(v.approvalStatus)}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge ${VALIDITY_BADGE[status]}`}>
                              {status === 'ok' && 'Valid'}
                              {status === 'due' && 'Due soon'}
                              {status === 'expired' && 'Expired'}
                              {status === 'missing' && 'Incomplete'}
                            </span>
                          </td>
                          <td className="text-right vehicle-rc-col-actions">
                            <button
                              type="button"
                              className="btn-icon text-blue mr-2"
                              onClick={() => startEdit(v)}
                              title="Edit"
                            >
                              <Pencil size={18} />
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
                        <td colSpan={11} className="text-center py-10 text-muted">
                          No vehicles yet. Click &quot;Add Vehicle&quot; to register one.
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
