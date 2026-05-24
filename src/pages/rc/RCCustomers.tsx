import React, { useState, useEffect, useCallback } from 'react';
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { uploadCustomerDeviceImage, uploadCustomerShopPhoto } from '../../lib/customerPhotoUpload';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import {
  buildCustomerDevice,
  buildCustomerProfileFields,
  createEmptyDeviceRow,
  customerDeviceCount,
  customerFormFromRecord,
  customerMapsUrl,
  deviceImageFromDevice,
  formatCustomerLocation,
  parseCustomerLocation,
  shopPhotoFieldsFromMeta,
  shopPhotoFromRecord,
  validateCustomerDevices,
  validateCustomerProfile,
  type CustomerDeviceFormValues,
  type CustomerFormValues,
} from '../../lib/customerProfileFields';
import {
  UserRound, Trash2, RefreshCw, Pencil, X, Plus, Save, ImageIcon, MapPin, ExternalLink,
} from 'lucide-react';
import type { Customer, CustomerDevice } from '../../types';
import {
  EMPTY_CUSTOMER_FORM,
  EMPTY_IMAGE_UPLOAD_STATE,
  CustomerFormFields,
  type CustomerDeviceUploadState,
  type ImageUploadState,
} from './CustomerFormFields';

function devicesStateFromRecord(record: Customer): CustomerDeviceUploadState[] {
  return (record.devices || []).map(device => ({
    row: {
      localId: device.id,
      serialNumber: device.serialNumber,
      productId: device.productId || '',
      productName: device.productName,
    },
    image: {
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: deviceImageFromDevice(device),
    },
  }));
}

export const RCCustomers: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const [shopPhoto, setShopPhoto] = useState<ImageUploadState>({ ...EMPTY_IMAGE_UPLOAD_STATE });
  const [pendingShopPhoto, setPendingShopPhoto] = useState<File | null>(null);
  const [shopPhotoRemoved, setShopPhotoRemoved] = useState(false);

  const [devices, setDevices] = useState<CustomerDeviceUploadState[]>([]);
  const [pendingDeviceImages, setPendingDeviceImages] = useState<Record<string, File>>({});
  const [removedDeviceImages, setRemovedDeviceImages] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');

  const fetchCustomers = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setListError('');
    try {
      const q = query(collection(db, 'customers'), where('rcId', '==', user.uid));
      const snap = await getDocs(q);
      const rows = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setCustomers(rows);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'permission-denied') {
        setListError(
          'Could not load customers. Deploy Firestore rules: firebase deploy --only firestore:rules,storage',
        );
      } else {
        setListError(err instanceof Error ? err.message : 'Failed to load customers.');
      }
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    Promise.resolve().then(() => fetchCustomers());
  }, [fetchCustomers]);

  const showForm = showAddForm || editingId !== null;
  const formBusy = submitting;

  const resetDevices = () => {
    setDevices([]);
    setPendingDeviceImages({});
    setRemovedDeviceImages(new Set());
  };

  const resetShopPhoto = () => {
    setShopPhoto({ ...EMPTY_IMAGE_UPLOAD_STATE });
    setPendingShopPhoto(null);
    setShopPhotoRemoved(false);
  };

  const resetForm = () => {
    setFormValues(EMPTY_CUSTOMER_FORM);
    resetShopPhoto();
    resetDevices();
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

  const patchForm = (patch: Partial<CustomerFormValues>) => {
    setFormValues(prev => ({ ...prev, ...patch }));
  };

  const handleShopPhotoSelect = (file: File) => {
    setPendingShopPhoto(file);
    setShopPhotoRemoved(false);
    const previewUrl = URL.createObjectURL(file);
    setShopPhoto({
      file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
      uploading: false,
      progress: 0,
    });
  };

  const handleShopPhotoRemove = () => {
    setPendingShopPhoto(null);
    setShopPhotoRemoved(true);
    setShopPhoto({ ...EMPTY_IMAGE_UPLOAD_STATE });
  };

  const handleDeviceAdd = () => {
    setDevices(prev => [...prev, { row: createEmptyDeviceRow(), image: { ...EMPTY_IMAGE_UPLOAD_STATE } }]);
  };

  const handleDeviceRemove = (localId: string) => {
    setDevices(prev => prev.filter(d => d.row.localId !== localId));
    setPendingDeviceImages(prev => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
    setRemovedDeviceImages(prev => {
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
  };

  const handleDeviceChange = (localId: string, patch: Partial<CustomerDeviceFormValues>) => {
    setDevices(prev =>
      prev.map(d => (d.row.localId === localId ? { ...d, row: { ...d.row, ...patch } } : d)),
    );
  };

  const handleDeviceImageSelect = (localId: string, file: File) => {
    setPendingDeviceImages(prev => ({ ...prev, [localId]: file }));
    setRemovedDeviceImages(prev => {
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
    const previewUrl = URL.createObjectURL(file);
    setDevices(prev =>
      prev.map(d =>
        d.row.localId === localId
          ? {
              ...d,
              image: {
                file: { url: previewUrl, path: '', name: file.name, contentType: file.type },
                uploading: false,
                progress: 0,
              },
            }
          : d,
      ),
    );
  };

  const handleDeviceImageRemove = (localId: string) => {
    setPendingDeviceImages(prev => {
      const next = { ...prev };
      delete next[localId];
      return next;
    });
    setRemovedDeviceImages(prev => new Set(prev).add(localId));
    setDevices(prev =>
      prev.map(d => (d.row.localId === localId ? { ...d, image: { ...EMPTY_IMAGE_UPLOAD_STATE } } : d)),
    );
  };

  const setDeviceImageState = (localId: string, patch: Partial<ImageUploadState>) => {
    setDevices(prev =>
      prev.map(d => (d.row.localId === localId ? { ...d, image: { ...d.image, ...patch } } : d)),
    );
  };

  const uploadShopPhoto = async (customerId: string): Promise<Partial<Customer>> => {
    if (shopPhotoRemoved && !pendingShopPhoto) return shopPhotoFieldsFromMeta(null);
    if (!pendingShopPhoto) {
      const existing = shopPhoto.file;
      if (existing?.url && !existing.url.startsWith('blob:')) {
        return shopPhotoFieldsFromMeta(existing);
      }
      return {};
    }
    setShopPhoto(prev => ({ ...prev, uploading: true, progress: 0 }));
    try {
      const meta = await uploadCustomerShopPhoto(customerId, pendingShopPhoto, pct => {
        setShopPhoto(prev => ({ ...prev, progress: pct }));
      });
      setShopPhoto({ file: meta, uploading: false, progress: 100 });
      return shopPhotoFieldsFromMeta(meta);
    } catch (err) {
      setShopPhoto(prev => ({ ...prev, uploading: false, progress: 0 }));
      throw err;
    }
  };

  const resolveDeviceImage = async (
    customerId: string,
    localId: string,
    current: ImageUploadState,
  ): Promise<ProductFileMeta | null> => {
    const pending = pendingDeviceImages[localId];
    if (removedDeviceImages.has(localId) && !pending) return null;

    if (!pending) {
      const existing = current.file;
      if (existing?.url && !existing.url.startsWith('blob:')) return existing;
      return null;
    }

    setDeviceImageState(localId, { uploading: true, progress: 0 });
    try {
      const meta = await uploadCustomerDeviceImage(customerId, localId, pending, pct => {
        setDeviceImageState(localId, { progress: pct });
      });
      setDeviceImageState(localId, { file: meta, uploading: false, progress: 100 });
      return meta;
    } catch (err) {
      setDeviceImageState(localId, { uploading: false, progress: 0 });
      throw err;
    }
  };

  const uploadAllDevices = async (customerId: string): Promise<CustomerDevice[]> => {
    const saved: CustomerDevice[] = [];
    for (const device of devices) {
      const image = await resolveDeviceImage(customerId, device.row.localId, device.image);
      saved.push(buildCustomerDevice(device.row, image));
    }
    return saved;
  };

  const validateForm = (): string | null => {
    const profileError = validateCustomerProfile(formValues);
    if (profileError) return profileError;
    return validateCustomerDevices(devices.map(d => d.row));
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
      const ref = doc(collection(db, 'customers'));
      const customerId = ref.id;
      const photoFields = await uploadShopPhoto(customerId);
      const deviceRecords = await uploadAllDevices(customerId);

      const record: Omit<Customer, 'id'> = {
        rcId: user!.uid,
        createdAt: new Date().toISOString(),
        createdByUid: user?.uid,
        ...buildCustomerProfileFields(formValues),
        ...photoFields,
        devices: deviceRecords,
      };
      await setDoc(ref, record);

      handleCloseForm();
      await fetchCustomers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (customerId: string) => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const photoFields = await uploadShopPhoto(customerId);
      const deviceRecords = await uploadAllDevices(customerId);

      const profile = buildCustomerProfileFields(formValues);
      const updates: Record<string, unknown> = {
        ...profile,
        ...photoFields,
        devices: deviceRecords,
        updatedAt: new Date().toISOString(),
      };
      if (!parseCustomerLocation(formValues)) {
        updates.location = deleteField();
      }

      await updateDoc(doc(db, 'customers', customerId), updates);
      handleCloseForm();
      await fetchCustomers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAdd = () => {
    setEditingId(null);
    resetForm();
    setShowAddForm(true);
  };

  const startEdit = (c: Customer) => {
    setShowAddForm(false);
    setEditingId(c.id);
    setFormValues(customerFormFromRecord(c));
    setShopPhoto({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: shopPhotoFromRecord(c),
    });
    setPendingShopPhoto(null);
    setShopPhotoRemoved(false);
    setDevices(devicesStateFromRecord(c));
    setPendingDeviceImages({});
    setRemovedDeviceImages(new Set());
    setError('');
  };

  const handleDelete = async (id: string, label: string) => {
    const ok = await confirm({
      title: 'Remove customer?',
      message: `Remove customer "${label}" from your centre?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await deleteDoc(doc(db, 'customers', id));
    await fetchCustomers();
  };

  const shopPhotoUrl = (c: Customer) => c.shopPhotoUrl || c.customerPhotoUrl;

  return (
    <div className="fade-in page-content">
      {showForm && (
        <InlineFormPanel id="customer-form" className="mb-6 inline-form-panel--wide inline-form-panel--customer">
          <div className="product-form-panel">
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="customer-form-title">
                  {showAddForm ? (
                    <>
                      <Plus className="inline-icon" /> Add Customer
                    </>
                  ) : (
                    <>
                      <Pencil className="inline-icon" /> Edit Customer
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
                <CustomerFormFields
                  mode={showAddForm ? 'create' : 'edit'}
                  values={formValues}
                  onChange={patchForm}
                  shopPhoto={shopPhoto}
                  onShopPhotoSelect={handleShopPhotoSelect}
                  onShopPhotoRemove={handleShopPhotoRemove}
                  devices={devices}
                  onDeviceChange={handleDeviceChange}
                  onDeviceAdd={handleDeviceAdd}
                  onDeviceRemove={handleDeviceRemove}
                  onDeviceImageSelect={handleDeviceImageSelect}
                  onDeviceImageRemove={handleDeviceImageRemove}
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
                      <Plus size={16} /> Add Customer
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
                <UserRound className="inline-icon" /> Customers
              </h2>
              <p className="text-muted text-sm mt-1">
                {customers.length} customer{customers.length !== 1 ? 's' : ''} registered
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
                <Plus size={16} /> Add Customer
              </button>
              <button className="btn-icon" onClick={fetchCustomers} title="Refresh" type="button">
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
                <table className="data-table data-table--customers-rc">
                  <thead>
                    <tr>
                      <th className="customer-rc-col-serial">#</th>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Devices</th>
                      <th>Address</th>
                      <th>Location</th>
                      <th className="text-right customer-rc-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c, index) => {
                      const mapsUrl = customerMapsUrl(c);
                      const photo = shopPhotoUrl(c);
                      return (
                        <tr key={c.id}>
                          <td className="customer-rc-col-serial text-muted text-sm">{index + 1}</td>
                          <td className="font-medium">
                            <div className="flex items-center gap-2">
                              {photo ? (
                                <img src={photo} alt="" className="customer-table-shop-thumb" />
                              ) : (
                                <span className="customer-table-shop-thumb customer-table-shop-thumb--placeholder">
                                  <ImageIcon size={18} />
                                </span>
                              )}
                              <span>{c.name || '—'}</span>
                            </div>
                          </td>
                          <td className="text-sm">{c.phone || '—'}</td>
                          <td className="text-sm">{customerDeviceCount(c)}</td>
                          <td className="text-sm text-muted max-w-[14rem] truncate" title={c.address}>
                            {c.address || '—'}
                          </td>
                          <td className="text-sm">
                            {mapsUrl ? (
                              <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="customer-map-link flex items-center gap-1"
                                title={formatCustomerLocation(c)}
                              >
                                <MapPin size={13} />
                                <span className="truncate max-w-[8rem]">{formatCustomerLocation(c)}</span>
                                <ExternalLink size={11} />
                              </a>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="text-right customer-rc-col-actions">
                            <button
                              type="button"
                              className="btn-icon text-blue mr-2"
                              onClick={() => startEdit(c)}
                              title="Edit"
                            >
                              <Pencil size={18} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon text-red"
                              onClick={() => handleDelete(c.id, c.name || c.phone)}
                              title="Remove"
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {customers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-muted">
                          No customers yet. Click &quot;Add Customer&quot; to register one.
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
