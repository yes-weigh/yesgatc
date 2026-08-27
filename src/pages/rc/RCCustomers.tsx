import React, { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  collection, getDocs, doc, setDoc, updateDoc, query, where, deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useRcScope } from '../../lib/roleScope';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { CustomerListTile } from '../../components/CustomerListTile';
import { uploadCustomerShopPhoto } from '../../lib/customerPhotoUpload';
import { normalizePhone, isValidPhone } from '../../lib/contactFields';
import { filterCustomersBySearch } from '../../lib/customerLookup';
import { buildCustomerTileStatsMap } from '../../lib/customerTileStats';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import {
  buildCustomerProfileFields,
  customerDeviceCount,
  customerFormFromRecord,
  parseCustomerLocation,
  shopPhotoFieldsFromMeta,
  shopPhotoFromRecord,
  validateCustomerProfile,
  type CustomerFormValues,
} from '../../lib/customerProfileFields';
import {
  UserRound,
  Pencil,
  Plus,
  Save,
  Search,
} from 'lucide-react';
import { FilterIcon } from '../../components/FilterIcon';
import { TablePagination } from '../../components/TablePagination';
import { CUSTOMER_LIST_PAGE_SIZE, paginateItems } from '../../lib/tablePagination';
import type { Customer, SiteCalibration } from '../../types';
import {
  EMPTY_CUSTOMER_FORM,
  EMPTY_IMAGE_UPLOAD_STATE,
  CustomerFormFields,
  type ImageUploadState,
} from './CustomerFormFields';

export const RCCustomers: React.FC = () => {
  const { rcUid, actorUid, isFieldStaff } = useRcScope();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [verifications, setVerifications] = useState<SiteCalibration[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const [shopPhoto, setShopPhoto] = useState<ImageUploadState>({ ...EMPTY_IMAGE_UPLOAD_STATE });
  const [pendingShopPhoto, setPendingShopPhoto] = useState<File | null>(null);
  const [shopPhotoRemoved, setShopPhotoRemoved] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formEditing, setFormEditing] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [districtFilter, setDistrictFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterSlots, setFilterSlots] = useState<{
    mobile: HTMLElement | null;
    desktop: HTMLElement | null;
  }>({ mobile: null, desktop: null });

  const normalizedPhoneSearch = normalizePhone(searchQuery);
  const phoneSearchComplete = isValidPhone(searchQuery);
  const hasSearchQuery = searchQuery.trim().length > 0;

  const districtOptions = useMemo(() => {
    const names = new Set<string>();
    for (const customer of customers) {
      const district = customer.district?.trim();
      if (district) names.add(district);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const displayedCustomers = useMemo(() => {
    const searched = filterCustomersBySearch(customers, searchQuery);
    if (districtFilter === 'all') return searched;
    return searched.filter(customer => (customer.district?.trim() || '') === districtFilter);
  }, [customers, searchQuery, districtFilter]);

  const customerStatsMap = useMemo(
    () => buildCustomerTileStatsMap(customers, verifications),
    [customers, verifications],
  );

  useEffect(() => {
    setPage(1);
  }, [searchQuery, districtFilter]);

  const pageCustomers = useMemo(
    () => paginateItems(displayedCustomers, page, CUSTOMER_LIST_PAGE_SIZE),
    [displayedCustomers, page],
  );

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
    if (!rcUid) return;
    setLoading(true);
    setListError('');
    try {
      const [customerSnap, verificationSnap] = await Promise.all([
        getDocs(query(collection(db, 'customers'), where('rcId', '==', rcUid))),
        getDocs(verificationRecordsQuery(db, rcUid, { isFieldStaff, actorUid })),
      ]);

      const rows = customerSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      const verificationRows = verificationSnap.docs.map(
        d => ({ id: d.id, ...d.data() } as SiteCalibration),
      );

      setCustomers(rows);
      setVerifications(verificationRows);
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
      setVerifications([]);
    } finally {
      setLoading(false);
    }
  }, [rcUid, isFieldStaff, actorUid]);

  useEffect(() => {
    Promise.resolve().then(() => fetchCustomers());
  }, [fetchCustomers]);

  useLayoutEffect(() => {
    setFilterSlots({
      mobile: document.getElementById('verification-filter-slot-mobile'),
      desktop: document.getElementById('verification-filter-slot-desktop'),
    });
  }, []);

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

  const showForm = showAddForm || editingId !== null;
  const formBusy = submitting;

  const resetShopPhoto = () => {
    setShopPhoto({ ...EMPTY_IMAGE_UPLOAD_STATE });
    setPendingShopPhoto(null);
    setShopPhotoRemoved(false);
  };

  const resetForm = () => {
    setFormValues(EMPTY_CUSTOMER_FORM);
    resetShopPhoto();
    setError('');
  };

  const restoreFormFromCustomer = (record: Customer) => {
    setFormValues(customerFormFromRecord(record));
    setShopPhoto({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: shopPhotoFromRecord(record),
    });
    setPendingShopPhoto(null);
    setShopPhotoRemoved(false);
    setError('');
  };

  const handleCloseForm = () => {
    if (formBusy) return;
    setShowAddForm(false);
    setEditingId(null);
    setFormEditing(false);
    resetForm();
  };

  const handleCancelFormEdit = () => {
    if (formBusy) return;
    if (editingId) {
      const record = customers.find(c => c.id === editingId);
      if (record) restoreFormFromCustomer(record);
      setFormEditing(false);
      setError('');
      return;
    }
    handleCloseForm();
  };

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || formBusy) return;
      if (formEditing && editingId) {
        handleCancelFormEdit();
        return;
      }
      handleCloseForm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm, formBusy, formEditing, editingId, customers]);

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

  const validateForm = (): string | null => validateCustomerProfile(formValues);

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

      const record: Omit<Customer, 'id'> = {
        rcId: rcUid!,
        createdAt: new Date().toISOString(),
        createdByUid: actorUid ?? undefined,
        ...buildCustomerProfileFields(formValues),
        ...photoFields,
        devices: [],
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

      const profile = buildCustomerProfileFields(formValues);
      const updates: Record<string, unknown> = {
        ...profile,
        ...photoFields,
        updatedAt: new Date().toISOString(),
      };
      if (!parseCustomerLocation(formValues)) {
        updates.location = deleteField();
      }

      await updateDoc(doc(db, 'customers', customerId), updates);

      const existing = customers.find(c => c.id === customerId);
      const updated: Customer = {
        ...(existing ?? { id: customerId, rcId: rcUid ?? '', createdAt: '', devices: [] }),
        ...profile,
        ...photoFields,
        devices: existing?.devices ?? [],
        updatedAt: updates.updatedAt as string,
      };
      if (!parseCustomerLocation(formValues)) {
        delete updated.location;
      }

      restoreFormFromCustomer(updated);
      setFormEditing(false);
      await fetchCustomers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAdd = () => {
    setEditingId(null);
    setFormEditing(true);
    resetForm();
    setShowAddForm(true);
  };

  const handleStartAddWithPhone = (phone: string) => {
    setEditingId(null);
    setFormEditing(true);
    resetForm();
    setFormValues({ ...EMPTY_CUSTOMER_FORM, phone: normalizePhone(phone) });
    setShowAddForm(true);
  };

  const startEdit = (c: Customer, openForEditing = false) => {
    setShowAddForm(false);
    setEditingId(c.id);
    setFormEditing(openForEditing);
    restoreFormFromCustomer(c);
  };

  const editingCustomer = editingId ? customers.find(c => c.id === editingId) ?? null : null;
  const filterSlot = filterSlots.mobile ?? filterSlots.desktop;
  const filterActive = districtFilter !== 'all';
  const filterControl = (
    <div className="wl-cert-filter verification-app-filter" ref={filterRef}>
      <button
        type="button"
        className={`wl-cert-filter-btn verification-app-filter__btn${
          filterOpen || filterActive ? ' wl-cert-filter-btn--on verification-app-filter__btn--on' : ''
        }`}
        aria-label="Filter customers by district"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen(open => !open)}
      >
        <FilterIcon size={18} />
      </button>
      {filterOpen ? (
        <div className="wl-cert-filter__pop" role="dialog" aria-label="Customer filters">
          <label className="wl-cert-filter__label" htmlFor="customer-filter-district">
            District
          </label>
          <select
            id="customer-filter-district"
            className="wl-cert-filter__select"
            value={districtFilter}
            onChange={event => setDistrictFilter(event.target.value)}
          >
            <option value="all">All districts</option>
            {districtOptions.map(district => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="fade-in page-content">
      {filterSlot ? createPortal(filterControl, filterSlot) : null}
      {showForm && (
        <InlineFormPanel id="customer-form" className="mb-6 inline-form-panel--wide inline-form-panel--customer">
          <div className="product-form-panel">
            <ListViewBackBar onBack={handleCloseForm} disabled={formBusy} />
            {error && (
              <div className="product-form-topbar product-form-topbar--alert-only">
                <p className="rc-form-topbar-error" role="alert">
                  {error}
                </p>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="product-form" autoComplete="off" noValidate>
              <div className="product-form-body">
                <CustomerFormFields
                  mode={showAddForm ? 'create' : 'edit'}
                  values={formValues}
                  onChange={patchForm}
                  shopPhoto={shopPhoto}
                  onShopPhotoSelect={handleShopPhotoSelect}
                  onShopPhotoRemove={handleShopPhotoRemove}
                  submitting={formBusy}
                  tileStats={editingId ? customerStatsMap.get(editingId) : undefined}
                  deviceCount={editingCustomer ? customerDeviceCount(editingCustomer) : 0}
                  editing={showAddForm ? true : formEditing}
                  onStartEdit={() => setFormEditing(true)}
                  onCancelEdit={handleCancelFormEdit}
                  onSave={() => {
                    if (editingId) void handleSaveEdit(editingId);
                  }}
                  existingCustomerWithPhone={
                    showAddForm && duplicateCustomer
                      ? { name: duplicateCustomer.name }
                      : null
                  }
                  lookup={
                    showAddForm
                      ? {
                          customers,
                          onSelectCustomer: customer => startEdit(customer, true),
                        }
                      : undefined
                  }
                />
              </div>
              {showAddForm && (
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
                      onClick={() => startEdit(duplicateCustomer, true)}
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
                    ) : (
                      <>
                        <Save size={18} /> Save
                      </>
                    )}
                  </button>
                </div>
              )}
            </form>
          </div>
        </InlineFormPanel>
      )}

      {!showForm && (
        <div className="rc-list-page">
          <section className="rc-customer-toolbar">
            <div className="rc-customer-toolbar__row">
              <button
                type="button"
                className="rc-vehicles-add-btn rc-customer-toolbar__add"
                onClick={handleStartAdd}
                aria-label="Add customer"
              >
                <Plus size={18} strokeWidth={2.5} aria-hidden />
              </button>
              <div className="search-wrap customer-phone-search rc-customer-toolbar__search">
                <Search size={16} className="search-icon" aria-hidden />
                <input
                  type="search"
                  className="search-input"
                  placeholder="Search name or phone"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  aria-label="Search customers by name or phone number"
                />
              </div>
              {!filterSlot ? filterControl : null}
            </div>
            {!loading && displayedCustomers.length > 0 ? (
              <TablePagination
                page={page}
                totalItems={displayedCustomers.length}
                pageSize={CUSTOMER_LIST_PAGE_SIZE}
                onPageChange={setPage}
                placement="top"
              />
            ) : null}
          </section>
          {listError && (
            <p className="rc-vehicles-summary-error" role="alert">
              {listError}
            </p>
          )}
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

          {loading ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : displayedCustomers.length === 0 ? (
            <div className="rc-vehicles-empty">
              <span className="rc-list-summary-icon rc-list-summary-icon--lg" aria-hidden>
                <UserRound size={24} strokeWidth={1.85} />
              </span>
              <p>
                {phoneSearchComplete
                  ? `No customer found with phone ${normalizedPhoneSearch}.`
                  : hasSearchQuery || filterActive
                    ? 'No customers match your search or filter.'
                    : 'No customers yet.'}
              </p>
              <button
                type="button"
                className="rc-vehicles-add-btn"
                onClick={handleStartAdd}
                aria-label="Add customer"
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                <span className="rc-vehicles-add-btn-label">Add Customer</span>
              </button>
            </div>
          ) : (
            <>
              <div className="rc-list-cards rc-customer-tiles">
                {pageCustomers.map(c => (
                  <CustomerListTile
                    key={c.id}
                    customer={c}
                    onEdit={() => startEdit(c)}
                  />
                ))}
              </div>
              <TablePagination
                page={page}
                totalItems={displayedCustomers.length}
                pageSize={CUSTOMER_LIST_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
