import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, getDocs, doc, setDoc, updateDoc, query, where, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { uploadCustomerShopPhoto } from '../../lib/customerPhotoUpload';
import { normalizePhone, isValidPhone } from '../../lib/contactFields';
import { tableEditCellProps } from '../../lib/tableEditCell';
import {
  buildCustomerDevice,
  buildCustomerProfileFields,
  createEmptyDeviceRow,
  customerDeviceCount,
  customerFormFromRecord,
  customerMapsUrl,
  deviceToFormRow,
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
  UserRound, RefreshCw, Pencil, X, Plus, Save, ImageIcon, MapPin, ExternalLink, Search,
} from 'lucide-react';
import type { Customer, CustomerDevice } from '../../types';
import {
  EMPTY_CUSTOMER_FORM,
  EMPTY_IMAGE_UPLOAD_STATE,
  CustomerFormFields,
  type CustomerDeviceRowState,
  type ImageUploadState,
} from './CustomerFormFields';

function devicesStateFromRecord(record: Customer): CustomerDeviceRowState[] {
  return (record.devices || []).map(device => ({ row: deviceToFormRow(device) }));
}

export const RCCustomers: React.FC = () => {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const [shopPhoto, setShopPhoto] = useState<ImageUploadState>({ ...EMPTY_IMAGE_UPLOAD_STATE });
  const [pendingShopPhoto, setPendingShopPhoto] = useState<File | null>(null);
  const [shopPhotoRemoved, setShopPhotoRemoved] = useState(false);

  const [devices, setDevices] = useState<CustomerDeviceRowState[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');

  const normalizedPhoneSearch = normalizePhone(phoneSearch);
  const phoneSearchComplete = normalizedPhoneSearch.length === 10;

  const displayedCustomers = useMemo(() => {
    if (!phoneSearchComplete) return customers;
    return customers.filter(c => normalizePhone(c.phone) === normalizedPhoneSearch);
  }, [customers, normalizedPhoneSearch, phoneSearchComplete]);

  const showCreateWithPhone =
    phoneSearchComplete && !loading && displayedCustomers.length === 0;

  const duplicateCustomer = useMemo(() => {
    if (!isValidPhone(formValues.phone)) return null;
    const phone = normalizePhone(formValues.phone);
    return (
      customers.find(
        c => normalizePhone(c.phone) === phone && c.id !== editingId,
      ) ?? null
    );
  }, [formValues.phone, customers, editingId]);

  const phoneDuplicateBlocksSave = showAddForm && duplicateCustomer !== null;

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
    setDevices(prev => [...prev, { row: createEmptyDeviceRow() }]);
  };

  const handleDeviceRemove = (localId: string) => {
    setDevices(prev => prev.filter(d => d.row.localId !== localId));
  };

  const handleDeviceChange = (localId: string, patch: Partial<CustomerDeviceFormValues>) => {
    setDevices(prev =>
      prev.map(d => (d.row.localId === localId ? { ...d, row: { ...d.row, ...patch } } : d)),
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

  const uploadAllDevices = (): CustomerDevice[] =>
    devices.map(device => buildCustomerDevice(device.row));

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
      const deviceRecords = uploadAllDevices();

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
      const deviceRecords = uploadAllDevices();

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

  const handleStartAddWithPhone = (phone: string) => {
    setEditingId(null);
    resetForm();
    setFormValues({ ...EMPTY_CUSTOMER_FORM, phone: normalizePhone(phone) });
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
    setError('');
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
                className="btn btn-secondary customer-form-close-btn text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                onClick={handleCloseForm}
                disabled={formBusy}
                aria-label="Close"
              >
                <X size={16} /> Close
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
                  submitting={formBusy}
                  existingCustomerWithPhone={
                    showAddForm && duplicateCustomer
                      ? { name: duplicateCustomer.name }
                      : null
                  }
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
                {phoneDuplicateBlocksSave && duplicateCustomer && (
                  <button
                    type="button"
                    className="btn btn-primary flex items-center gap-2"
                    onClick={() => startEdit(duplicateCustomer)}
                    disabled={formBusy}
                  >
                    <Pencil size={16} /> Load customer and edit
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-primary flex items-center gap-2"
                  disabled={formBusy || phoneDuplicateBlocksSave}
                >
                  {formBusy ? (
                    <span className="spinner-inline"></span>
                  ) : showAddForm ? (
                    <>
                      <Save size={18} /> Save
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
          <div className="panel-header customer-panel-header justify-between">
            <div className="customer-panel-head-meta">
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
            <div className="customer-list-toolbar flex items-center gap-2">
              <div className="search-wrap customer-phone-search">
                <Search size={16} className="search-icon" aria-hidden />
                <input
                  type="tel"
                  inputMode="numeric"
                  className="search-input"
                  placeholder="Search by phone"
                  value={phoneSearch}
                  onChange={e => setPhoneSearch(normalizePhone(e.target.value))}
                  maxLength={10}
                  aria-label="Search customers by phone number"
                />
              </div>
              <button
                type="button"
                className="btn-icon customer-list-toolbar-btn customer-list-toolbar-btn--add"
                onClick={handleStartAdd}
                title="Add customer"
                aria-label="Add customer"
              >
                <Plus size={18} />
              </button>
              <button
                className="btn-icon customer-list-toolbar-btn"
                onClick={fetchCustomers}
                title="Refresh"
                type="button"
                aria-label="Refresh customers"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
          {showCreateWithPhone && (
            <div className="customer-phone-search-actions">
              <p className="text-muted text-sm m-0">
                No customer found with phone {normalizedPhoneSearch}.
              </p>
              <button
                type="button"
                className="btn btn-primary text-sm py-1.5 px-3"
                onClick={() => handleStartAddWithPhone(normalizedPhoneSearch)}
              >
                Create customer with this phone number
              </button>
            </div>
          )}
          <div className="panel-body p-0">
            {loading ? (
              <div className="flex justify-center py-16">
                <span className="spinner-inline large"></span>
              </div>
            ) : (
              <div className="table-scroll-wrap">
                <table className="data-table data-table--customers-rc data-table--mobile-cards">
                  <thead>
                    <tr>
                      <th className="customer-rc-col-serial">#</th>
                      <th className="customer-rc-col-customer">Customer</th>
                      <th>Phone</th>
                      <th>Devices</th>
                      <th>Address</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCustomers.map((c, index) => {
                      const mapsUrl = customerMapsUrl(c);
                      const photo = shopPhotoUrl(c);
                      const openEdit = () => startEdit(c);
                      const editCell = tableEditCellProps(openEdit, 'Edit customer');

                      return (
                        <tr key={c.id} className="table-mobile-row">
                          <td className="customer-rc-col-serial text-muted text-sm table-mobile-col-hide">{index + 1}</td>
                          <td {...editCell} className="customer-rc-col-customer font-medium table-mobile-col-primary table-col-editable">
                            <div className="flex items-center gap-2 min-w-0">
                              {photo ? (
                                <img src={photo} alt="" className="customer-table-shop-thumb shrink-0" />
                              ) : (
                                <span className="customer-table-shop-thumb customer-table-shop-thumb--placeholder shrink-0">
                                  <ImageIcon size={18} />
                                </span>
                              )}
                              <div className="min-w-0">
                                <span className="table-mobile-primary-text">{c.name || '—'}</span>
                                <div className="table-mobile-summary">
                                  <span>{c.phone || '—'}</span>
                                  <span className="table-mobile-summary-meta">
                                    {customerDeviceCount(c)} device{customerDeviceCount(c) !== 1 ? 's' : ''}
                                  </span>
                                  {c.address && (
                                    <span className="table-mobile-summary-meta">{c.address}</span>
                                  )}
                                  {mapsUrl && (
                                    <span className="customer-map-link flex items-center gap-1">
                                      <MapPin size={13} aria-hidden />
                                      <span>{formatCustomerLocation(c)}</span>
                                      <a
                                        href={mapsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="customer-map-link-icon"
                                        title="Open in maps"
                                        aria-label="Open location in maps"
                                        onClick={e => e.stopPropagation()}
                                      >
                                        <ExternalLink size={11} />
                                      </a>
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {c.phone || '—'}
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {customerDeviceCount(c)}
                          </td>
                          <td
                            {...editCell}
                            className="text-sm text-muted max-w-[14rem] truncate table-mobile-col-hide table-col-editable"
                            title={c.address || 'Edit customer'}
                          >
                            {c.address || '—'}
                          </td>
                          <td {...editCell} className="text-sm table-mobile-col-hide table-col-editable">
                            {mapsUrl ? (
                              <span className="customer-map-link flex items-center gap-1">
                                <MapPin size={13} aria-hidden />
                                <span className="truncate max-w-[8rem]">{formatCustomerLocation(c)}</span>
                                <a
                                  href={mapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="customer-map-link-icon"
                                  title="Open in maps"
                                  aria-label="Open location in maps"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <ExternalLink size={11} />
                                </a>
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {displayedCustomers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-muted">
                          {phoneSearchComplete
                            ? `No customer found with phone ${normalizedPhoneSearch}.`
                            : 'No customers yet. Use + to register one.'}
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
