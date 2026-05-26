import React, { useEffect, useState } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { Pencil, Save, X } from 'lucide-react';
import { db } from '../../firebase';
import { uploadCustomerShopPhoto } from '../../lib/customerPhotoUpload';
import {
  buildCustomerDevice,
  buildCustomerProfileFields,
  createEmptyDeviceRow,
  customerFormFromRecord,
  deviceToFormRow,
  parseCustomerLocation,
  shopPhotoFieldsFromMeta,
  shopPhotoFromRecord,
  validateCustomerDevices,
  validateCustomerProfile,
  type CustomerDeviceFormValues,
  type CustomerFormValues,
} from '../../lib/customerProfileFields';
import type { Customer, CustomerDevice } from '../../types';
import {
  CustomerFormFields,
  EMPTY_CUSTOMER_FORM,
  EMPTY_IMAGE_UPLOAD_STATE,
  type CustomerDeviceRowState,
  type ImageUploadState,
} from './CustomerFormFields';

function devicesStateFromRecord(record: Customer): CustomerDeviceRowState[] {
  return (record.devices || []).map(device => ({ row: deviceToFormRow(device) }));
}

type CustomerInlineEditPanelProps = {
  customer: Customer;
  onSaved: (customer: Customer) => void;
  onClose: () => void;
};

export const CustomerInlineEditPanel: React.FC<CustomerInlineEditPanelProps> = ({
  customer,
  onSaved,
  onClose,
}) => {
  const [formValues, setFormValues] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const [shopPhoto, setShopPhoto] = useState<ImageUploadState>({ ...EMPTY_IMAGE_UPLOAD_STATE });
  const [pendingShopPhoto, setPendingShopPhoto] = useState<File | null>(null);
  const [shopPhotoRemoved, setShopPhotoRemoved] = useState(false);
  const [devices, setDevices] = useState<CustomerDeviceRowState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setFormValues(customerFormFromRecord(customer));
    setShopPhoto({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: shopPhotoFromRecord(customer),
    });
    setPendingShopPhoto(null);
    setShopPhotoRemoved(false);
    setDevices(devicesStateFromRecord(customer));
    setError('');
  }, [customer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

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

  const validateForm = (): string | null => {
    const profileError = validateCustomerProfile(formValues);
    if (profileError) return profileError;
    return validateCustomerDevices(devices.map(d => d.row));
  };

  const handleSave = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const photoFields = await uploadShopPhoto(customer.id);
      const deviceRecords: CustomerDevice[] = devices.map(device => buildCustomerDevice(device.row));

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

      await updateDoc(doc(db, 'customers', customer.id), updates);

      const updated: Customer = {
        ...customer,
        ...profile,
        ...photoFields,
        devices: deviceRecords,
        updatedAt: updates.updatedAt as string,
      };
      if (!parseCustomerLocation(formValues)) {
        delete updated.location;
      }

      onSaved(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update customer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="verification-customer-edit inline-form-panel--customer site-calibration-form-span-full">
      <div className="product-form-panel verification-customer-edit-panel">
        <div className="product-form-topbar">
          <div className="product-form-topbar-text">
            <h2>
              <Pencil className="inline-icon" /> Edit Customer
            </h2>
            <p className="rc-form-topbar-error" role={error ? 'alert' : undefined}>
              {error || '\u00a0'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary customer-form-close-btn text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close customer edit"
          >
            <X size={16} /> Close
          </button>
        </div>

        <div className="product-form-body">
          <CustomerFormFields
            mode="edit"
            values={formValues}
            onChange={patchForm}
            shopPhoto={shopPhoto}
            onShopPhotoSelect={handleShopPhotoSelect}
            onShopPhotoRemove={handleShopPhotoRemove}
            devices={devices}
            onDeviceChange={handleDeviceChange}
            onDeviceAdd={handleDeviceAdd}
            onDeviceRemove={handleDeviceRemove}
            submitting={submitting}
          />
        </div>

        <div className="product-form-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex items-center gap-2"
            onClick={() => void handleSave()}
            disabled={submitting}
          >
            {submitting ? (
              <span className="spinner-inline"></span>
            ) : (
              <>
                <Save size={18} /> Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
