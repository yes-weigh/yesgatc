import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { tableEditCellProps } from '../../lib/tableEditCell';
import { buildCustomerDevice } from '../../lib/customerProfileFields';
import {
  buildSiteCalibrationFromRow,
  createEmptyVerificationDeviceRow,
  deviceImageStatesFromRows,
  emptyDeviceScaleImageState,
  EMPTY_VERIFICATION_SESSION,
  scaleImageFieldsFromMeta,
  scaleImageFromRecord,
  verificationSessionFromRecord,
  validateVerificationSession,
  verificationTypeLabel,
  type DeviceScaleImageState,
  type VerificationDeviceRowValues,
  type VerificationSessionValues,
} from '../../lib/siteCalibrationProfileFields';
import { uploadSiteCalibrationScaleImage } from '../../lib/siteCalibrationPhotoUpload';
import { formatProductMpe } from '../../lib/productCalculations';
import {
  Trash2, RefreshCw, Pencil, X, Plus, Save, ImageIcon, ShieldCheck,
} from 'lucide-react';
import type { Customer, SiteCalibration } from '../../types';
import { VerificationSessionFields } from './VerificationSessionFields';

export const RCSiteCalibration: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sessionValues, setSessionValues] = useState<VerificationSessionValues>(EMPTY_VERIFICATION_SESSION);
  const [deviceImages, setDeviceImages] = useState<Record<string, DeviceScaleImageState>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');

  const fetchRecords = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setListError('');
    try {
      const q = query(collection(db, 'siteCalibrations'), where('rcId', '==', user.uid));
      const snap = await getDocs(q);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<SiteCalibration, 'id'>) }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setRecords(rows);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'permission-denied') {
        setListError(
          'Could not load verification records. Deploy Firestore rules: firebase deploy --only firestore:rules',
        );
      } else {
        setListError(err instanceof Error ? err.message : 'Failed to load verification records.');
      }
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  const fetchCustomers = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const q = query(collection(db, 'customers'), where('rcId', '==', user.uid));
      const snap = await getDocs(q);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCustomers(rows);
    } catch {
      setCustomers([]);
    }
  }, [user?.uid]);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchRecords();
      fetchCustomers();
    });
  }, [fetchRecords, fetchCustomers]);

  const showForm = showAddForm || editingId !== null;
  const formBusy = submitting;
  const isEditMode = editingId !== null;

  const resetForm = () => {
    setSessionValues(EMPTY_VERIFICATION_SESSION);
    setDeviceImages({});
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

  const patchSession = (patch: Partial<VerificationSessionValues>) => {
    setSessionValues(prev => ({ ...prev, ...patch }));
  };

  const handleCustomerChange = (
    _customerId: string,
    _customerName: string,
    devices: VerificationDeviceRowValues[],
  ) => {
    setDeviceImages(deviceImageStatesFromRows(devices));
  };

  const handleDeviceChange = (localId: string, patch: Partial<VerificationDeviceRowValues>) => {
    setSessionValues(prev => ({
      ...prev,
      devices: prev.devices.map(row => (row.localId === localId ? { ...row, ...patch } : row)),
    }));
  };

  const handleDeviceAdd = () => {
    const row = createEmptyVerificationDeviceRow();
    setSessionValues(prev => ({ ...prev, devices: [...prev.devices, row] }));
    setDeviceImages(prev => ({ ...prev, [row.localId]: emptyDeviceScaleImageState() }));
  };

  const handleDeviceRemove = (localId: string) => {
    setSessionValues(prev => ({
      ...prev,
      devices: prev.devices.filter(row => row.localId !== localId),
    }));
    setDeviceImages(prev => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
  };

  const handleScaleImageSelect = (localId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setDeviceImages(prev => ({
      ...prev,
      [localId]: {
        ...(prev[localId] ?? emptyDeviceScaleImageState()),
        pendingFile: file,
        removed: false,
        file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
        uploading: false,
        progress: 0,
      },
    }));
  };

  const handleScaleImageRemove = (localId: string) => {
    setDeviceImages(prev => ({
      ...prev,
      [localId]: emptyDeviceScaleImageState(),
    }));
  };

  const uploadRowScaleImage = async (
    recordId: string,
    localId: string,
  ): Promise<Partial<SiteCalibration>> => {
    const image = deviceImages[localId] ?? emptyDeviceScaleImageState();
    if (image.removed && !image.pendingFile) return scaleImageFieldsFromMeta(null);
    if (!image.pendingFile) {
      if (image.file?.url && !image.file.url.startsWith('blob:')) {
        return scaleImageFieldsFromMeta(image.file);
      }
      return {};
    }

    setDeviceImages(prev => ({
      ...prev,
      [localId]: { ...(prev[localId] ?? emptyDeviceScaleImageState()), uploading: true, progress: 0 },
    }));

    try {
      const meta = await uploadSiteCalibrationScaleImage(recordId, image.pendingFile, pct => {
        setDeviceImages(prev => ({
          ...prev,
          [localId]: { ...(prev[localId] ?? emptyDeviceScaleImageState()), progress: pct },
        }));
      });
      setDeviceImages(prev => ({
        ...prev,
        [localId]: {
          ...(prev[localId] ?? emptyDeviceScaleImageState()),
          file: meta,
          uploading: false,
          progress: 100,
          pendingFile: null,
          removed: false,
        },
      }));
      return scaleImageFieldsFromMeta(meta);
    } catch (err) {
      setDeviceImages(prev => ({
        ...prev,
        [localId]: {
          ...(prev[localId] ?? emptyDeviceScaleImageState()),
          uploading: false,
          progress: 0,
        },
      }));
      throw err;
    }
  };

  const syncNewCustomerDevices = async (rows: VerificationDeviceRowValues[]) => {
    const newRows = rows.filter(row => row.isNewDevice);
    if (newRows.length === 0) return;

    const customer = customers.find(c => c.id === sessionValues.customerId);
    const existing = customer?.devices || [];
    const added = newRows.map(row =>
      buildCustomerDevice({
        localId: row.localId,
        productId: row.productId,
        productName: row.productName,
        serialNumber: row.serialNumber,
      }),
    );

    await updateDoc(doc(db, 'customers', sessionValues.customerId), {
      devices: [...existing, ...added],
      updatedAt: new Date().toISOString(),
    });

    setCustomers(prev =>
      prev.map(c =>
        c.id === sessionValues.customerId
          ? { ...c, devices: [...existing, ...added], updatedAt: new Date().toISOString() }
          : c,
      ),
    );
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showAddForm) await handleCreate();
    else if (editingId) await handleSaveEdit(editingId);
  };

  const handleCreate = async () => {
    setError('');
    const validationError = validateVerificationSession(sessionValues, deviceImages);
    if (validationError) {
      setError(validationError);
      return;
    }

    const includedRows = sessionValues.devices.filter(row => row.included);
    setSubmitting(true);
    try {
      await syncNewCustomerDevices(includedRows);

      for (const row of includedRows) {
        const ref = doc(collection(db, 'siteCalibrations'));
        const recordId = ref.id;
        const imageFields = await uploadRowScaleImage(recordId, row.localId);
        const deviceId = row.isNewDevice ? row.localId : row.deviceId;

        const record: Omit<SiteCalibration, 'id'> = {
          rcId: user!.uid,
          createdAt: new Date().toISOString(),
          createdByUid: user?.uid,
          ...buildSiteCalibrationFromRow(sessionValues, { ...row, deviceId }),
          ...imageFields,
        };
        await setDoc(ref, record);
      }

      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save verification records.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (recordId: string) => {
    const validationError = validateVerificationSession(sessionValues, deviceImages);
    if (validationError) {
      setError(validationError);
      return;
    }

    const row = sessionValues.devices[0];
    if (!row) {
      setError('Device data is missing.');
      return;
    }

    setSubmitting(true);
    try {
      const imageFields = await uploadRowScaleImage(recordId, row.localId);
      await updateDoc(doc(db, 'siteCalibrations', recordId), {
        ...buildSiteCalibrationFromRow(sessionValues, row),
        ...imageFields,
        updatedAt: new Date().toISOString(),
      });
      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update verification record.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAdd = () => {
    setEditingId(null);
    resetForm();
    setShowAddForm(true);
  };

  const startEdit = (record: SiteCalibration) => {
    setShowAddForm(false);
    setEditingId(record.id);
    const session = verificationSessionFromRecord(record);
    setSessionValues(session);
    const image = scaleImageFromRecord(record);
    setDeviceImages({
      [session.devices[0]?.localId || record.id]: {
        file: image,
        uploading: false,
        progress: 0,
        pendingFile: null,
        removed: false,
      },
    });
    setError('');
  };

  const handleDelete = async (record: SiteCalibration) => {
    const label = `${verificationTypeLabel(record.verificationType)} · ${record.customerName}`;
    const ok = await confirm({
      title: 'Remove verification record?',
      message: `Remove "${label}"?\nThis cannot be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await deleteDoc(doc(db, 'siteCalibrations', record.id));
    await fetchRecords();
  };

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

  const includedDeviceCount = sessionValues.devices.filter(d => d.included).length;

  return (
    <div className="fade-in page-content">
      {showForm && (
        <InlineFormPanel
          id="site-calibration-form"
          className="mb-6 inline-form-panel--wide inline-form-panel--calibration"
        >
          <div className="product-form-panel">
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="site-calibration-form-title">
                  {showAddForm ? (
                    <>
                      <Plus className="inline-icon" /> New Verification
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Verification
                    </>
                  )}
                </h2>
                <p className="text-muted text-sm mt-1 mb-0">
                  {showAddForm
                    ? sessionValues.customerId
                      ? `${includedDeviceCount} device${includedDeviceCount !== 1 ? 's' : ''} selected`
                      : 'Select a customer to load registered devices'
                    : 'Update verification data for this device'}
                </p>
                <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
                  {error || '\u00a0'}
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
                <VerificationSessionFields
                  values={sessionValues}
                  onChange={patchSession}
                  onCustomerChange={handleCustomerChange}
                  deviceImages={deviceImages}
                  onDeviceChange={handleDeviceChange}
                  onDeviceAdd={handleDeviceAdd}
                  onDeviceRemove={handleDeviceRemove}
                  onScaleImageSelect={handleScaleImageSelect}
                  onScaleImageRemove={handleScaleImageRemove}
                  customers={customers}
                  submitting={formBusy}
                  lockCustomer={isEditMode}
                  lockExistingDevices={isEditMode}
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
                      <Plus size={16} /> Save{includedDeviceCount > 1 ? ` (${includedDeviceCount})` : ''}
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
                <ShieldCheck className="inline-icon" /> Verification
              </h2>
              <p className="text-muted text-sm mt-1">
                {records.length} record{records.length !== 1 ? 's' : ''}
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
                <Plus size={16} /> New
              </button>
              <button className="btn-icon" onClick={fetchRecords} title="Refresh" type="button">
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
                <table className="data-table data-table--site-calibration data-table--mobile-cards">
                  <thead>
                    <tr>
                      <th className="site-calibration-col-serial">#</th>
                      <th>Type</th>
                      <th>Customer</th>
                      <th>Product</th>
                      <th>Serial</th>
                      <th>MPE</th>
                      <th className="site-calibration-col-image">Scale</th>
                      <th>Temp (°C)</th>
                      <th>Humidity (%)</th>
                      <th>Seal ID</th>
                      <th>Date</th>
                      <th className="text-right site-calibration-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, index) => {
                      const openEdit = () => startEdit(r);
                      const editCell = tableEditCellProps(openEdit, 'Edit verification record');

                      return (
                        <tr key={r.id} className="table-mobile-row table-mobile-row--actions">
                          <td className="site-calibration-col-serial text-muted text-sm table-mobile-col-hide">{index + 1}</td>
                          <td {...editCell} className="table-mobile-col-hide table-col-editable">
                            <span
                              className={`status-badge ${
                                r.verificationType === 'OV' ? 'site-calibration-type-ov' : 'site-calibration-type-rv'
                              }`}
                            >
                              {r.verificationType}
                            </span>
                          </td>
                          <td {...editCell} className="font-medium table-mobile-col-primary table-col-editable">
                            <span className="table-mobile-primary-text">{r.customerName || '—'}</span>
                            <div className="table-mobile-summary">
                              <span className="table-mobile-summary-badges">
                                <span
                                  className={`status-badge ${
                                    r.verificationType === 'OV' ? 'site-calibration-type-ov' : 'site-calibration-type-rv'
                                  }`}
                                >
                                  {r.verificationType}
                                </span>
                              </span>
                              <span>{r.productName || '—'}</span>
                              <span className="text-mono table-mobile-summary-meta">
                                {r.serialNumber || '—'} · MPE {formatProductMpe(r.maximumPermissibleError)}
                              </span>
                              <span className="table-mobile-summary-meta">
                                {r.ambientTemperature || '—'}°C · {r.relativeHumidity || '—'}% · Seal {r.sealIdentificationNumber || '—'}
                              </span>
                              <span className="table-mobile-summary-meta">{formatDate(r.createdAt)}</span>
                            </div>
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {r.productName || '—'}
                          </td>
                          <td {...editCell} className="text-sm text-mono table-mobile-col-hide table-col-editable">
                            {r.serialNumber || '—'}
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {formatProductMpe(r.maximumPermissibleError)}
                          </td>
                          <td {...editCell} className="site-calibration-col-image table-mobile-col-hide table-col-editable">
                            {r.scaleImageUrl ? (
                              <img
                                src={r.scaleImageUrl}
                                alt=""
                                className="site-calibration-table-thumb"
                              />
                            ) : (
                              <span className="site-calibration-table-thumb site-calibration-table-thumb--placeholder">
                                <ImageIcon size={16} />
                              </span>
                            )}
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {r.ambientTemperature || '—'}
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {r.relativeHumidity || '—'}
                          </td>
                          <td {...editCell} className="text-sm text-mono table-mobile-col-hide table-col-editable">
                            {r.sealIdentificationNumber || '—'}
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {formatDate(r.createdAt)}
                          </td>
                          <td className="text-right site-calibration-col-actions table-mobile-col-actions">
                            <button
                              type="button"
                              className="btn-icon text-red"
                              onClick={() => handleDelete(r)}
                              title="Remove"
                              aria-label={`Remove verification record for ${r.customerName}`}
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {records.length === 0 && (
                      <tr>
                        <td colSpan={12} className="text-center py-10 text-muted">
                          No verification records yet. Click &quot;New&quot; to add one.
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
