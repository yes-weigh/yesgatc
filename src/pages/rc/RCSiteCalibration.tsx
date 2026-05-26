import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { tableEditCellProps } from '../../lib/tableEditCell';
import {
  buildSiteCalibrationFields,
  EMPTY_SITE_CALIBRATION_FORM,
  scaleImageFieldsFromMeta,
  scaleImageFromRecord,
  siteCalibrationFormFromRecord,
  validateScaleImage,
  validateSiteCalibrationForm,
  verificationTypeLabel,
  type SiteCalibrationFormValues,
} from '../../lib/siteCalibrationProfileFields';
import { uploadSiteCalibrationScaleImage } from '../../lib/siteCalibrationPhotoUpload';
import { formatProductMpe } from '../../lib/productCalculations';
import {
  Gauge, Trash2, RefreshCw, Pencil, X, Plus, Save, ImageIcon,
} from 'lucide-react';
import type { Customer, SiteCalibration } from '../../types';
import { SiteCalibrationFormFields } from './SiteCalibrationFormFields';
import {
  EMPTY_IMAGE_UPLOAD_STATE,
  type ImageUploadState,
} from './CustomerFormFields';

export const RCSiteCalibration: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<SiteCalibrationFormValues>(EMPTY_SITE_CALIBRATION_FORM);
  const [scaleImage, setScaleImage] = useState<ImageUploadState>({ ...EMPTY_IMAGE_UPLOAD_STATE });
  const [pendingScaleImage, setPendingScaleImage] = useState<File | null>(null);
  const [scaleImageRemoved, setScaleImageRemoved] = useState(false);

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
          'Could not load site calibrations. Deploy Firestore rules: firebase deploy --only firestore:rules',
        );
      } else {
        setListError(err instanceof Error ? err.message : 'Failed to load site calibrations.');
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

  const resetScaleImage = () => {
    setScaleImage({ ...EMPTY_IMAGE_UPLOAD_STATE });
    setPendingScaleImage(null);
    setScaleImageRemoved(false);
  };

  const resetForm = () => {
    setFormValues(EMPTY_SITE_CALIBRATION_FORM);
    resetScaleImage();
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

  const patchForm = (patch: Partial<SiteCalibrationFormValues>) => {
    setFormValues(prev => ({ ...prev, ...patch }));
  };

  const handleScaleImageSelect = (file: File) => {
    setPendingScaleImage(file);
    setScaleImageRemoved(false);
    const previewUrl = URL.createObjectURL(file);
    setScaleImage({
      file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
      uploading: false,
      progress: 0,
    });
  };

  const handleScaleImageRemove = () => {
    setPendingScaleImage(null);
    setScaleImageRemoved(true);
    setScaleImage({ ...EMPTY_IMAGE_UPLOAD_STATE });
  };

  const uploadScaleImage = async (recordId: string): Promise<Partial<SiteCalibration>> => {
    if (scaleImageRemoved && !pendingScaleImage) return scaleImageFieldsFromMeta(null);
    if (!pendingScaleImage) {
      const existing = scaleImage.file;
      if (existing?.url && !existing.url.startsWith('blob:')) {
        return scaleImageFieldsFromMeta(existing);
      }
      return {};
    }
    setScaleImage(prev => ({ ...prev, uploading: true, progress: 0 }));
    try {
      const meta = await uploadSiteCalibrationScaleImage(recordId, pendingScaleImage, pct => {
        setScaleImage(prev => ({ ...prev, progress: pct }));
      });
      setScaleImage({ file: meta, uploading: false, progress: 100 });
      return scaleImageFieldsFromMeta(meta);
    } catch (err) {
      setScaleImage(prev => ({ ...prev, uploading: false, progress: 0 }));
      throw err;
    }
  };

  const validateForm = (): string | null => {
    const profileError = validateSiteCalibrationForm(formValues);
    if (profileError) return profileError;
    return validateScaleImage(scaleImage.file, pendingScaleImage, scaleImageRemoved);
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
      const ref = doc(collection(db, 'siteCalibrations'));
      const recordId = ref.id;
      const imageFields = await uploadScaleImage(recordId);

      const record: Omit<SiteCalibration, 'id'> = {
        rcId: user!.uid,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        ...buildSiteCalibrationFields(formValues),
        ...imageFields,
      };
      await setDoc(ref, record);
      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save site calibration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (recordId: string) => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const imageFields = await uploadScaleImage(recordId);
      await updateDoc(doc(db, 'siteCalibrations', recordId), {
        ...buildSiteCalibrationFields(formValues),
        ...imageFields,
        updatedAt: new Date().toISOString(),
      });
      handleCloseForm();
      await fetchRecords();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update site calibration.');
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
    setFormValues(siteCalibrationFormFromRecord(record));
    setScaleImage({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: scaleImageFromRecord(record),
    });
    setPendingScaleImage(null);
    setScaleImageRemoved(false);
    setError('');
  };

  const handleDelete = async (record: SiteCalibration) => {
    const label = `${verificationTypeLabel(record.verificationType)} · ${record.customerName}`;
    const ok = await confirm({
      title: 'Remove site calibration?',
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
                      <Plus className="inline-icon" /> New Site Calibration
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Site Calibration
                    </>
                  )}
                </h2>
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
                <SiteCalibrationFormFields
                  values={formValues}
                  onChange={patchForm}
                  customers={customers}
                  scaleImage={scaleImage}
                  onScaleImageSelect={handleScaleImageSelect}
                  onScaleImageRemove={handleScaleImageRemove}
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
                      <Plus size={16} /> Save
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
                <Gauge className="inline-icon" /> Site Calibration
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
                      const editCell = tableEditCellProps(openEdit, 'Edit site calibration');

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
                              aria-label={`Remove site calibration for ${r.customerName}`}
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
                          No site calibrations yet. Click &quot;New&quot; to add one.
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
