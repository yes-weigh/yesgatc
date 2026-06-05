import React, { useEffect, useState } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { uploadCustomerShopPhoto } from '../../lib/customerPhotoUpload';
import {
  buildCustomerProfileFields,
  customerFormFromRecord,
  deviceToFormRow,
  parseCustomerLocation,
  shopPhotoFieldsFromMeta,
  shopPhotoFromRecord,
  validateCustomerProfile,
  type CustomerFormValues,
} from '../../lib/customerProfileFields';
import type { Customer } from '../../types';
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
  const [formEditing, setFormEditing] = useState(false);
  const [error, setError] = useState('');

  const restoreFormFromCustomer = (record: Customer) => {
    setFormValues(customerFormFromRecord(record));
    setShopPhoto({
      ...EMPTY_IMAGE_UPLOAD_STATE,
      file: shopPhotoFromRecord(record),
    });
    setPendingShopPhoto(null);
    setShopPhotoRemoved(false);
    setDevices(devicesStateFromRecord(record));
    setError('');
  };

  useEffect(() => {
    restoreFormFromCustomer(customer);
    setFormEditing(false);
  }, [customer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || submitting) return;
      if (formEditing) {
        restoreFormFromCustomer(customer);
        setFormEditing(false);
        setError('');
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting, formEditing, customer]);

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

  const handleSave = async () => {
    const validationError = validateCustomerProfile(formValues);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const photoFields = await uploadShopPhoto(customer.id);

      const profile = buildCustomerProfileFields(formValues);
      const updates: Record<string, unknown> = {
        ...profile,
        ...photoFields,
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
        updatedAt: updates.updatedAt as string,
      };
      if (!parseCustomerLocation(formValues)) {
        delete updated.location;
      }

      restoreFormFromCustomer(updated);
      setFormEditing(false);
      onSaved(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update customer.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    if (submitting) return;
    restoreFormFromCustomer(customer);
    setFormEditing(false);
    setError('');
  };

  return (
    <div className="verification-customer-edit inline-form-panel--customer site-calibration-form-span-full">
      <div className="product-form-panel verification-customer-edit-panel">
        {error && (
          <div className="product-form-topbar product-form-topbar--alert-only">
            <p className="rc-form-topbar-error" role="alert">
              {error}
            </p>
          </div>
        )}

        <div className="product-form-body">
          <CustomerFormFields
            mode="edit"
            values={formValues}
            onChange={patchForm}
            shopPhoto={shopPhoto}
            onShopPhotoSelect={handleShopPhotoSelect}
            onShopPhotoRemove={handleShopPhotoRemove}
            devices={devices}
            submitting={submitting}
            editing={formEditing}
            onStartEdit={() => setFormEditing(true)}
            onCancelEdit={handleCancelEdit}
            onSave={() => void handleSave()}
            customerId={customer.id}
          />
        </div>
      </div>
    </div>
  );
};
