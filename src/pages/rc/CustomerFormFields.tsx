import React, { useRef } from 'react';
import { CustomerFormEditToolbar } from '../../components/CustomerFormEditToolbar';
import { CustomerStatsTiles } from '../../components/CustomerStatsTiles';
import { PartyInformationForm } from '../../components/PartyInformationForm';
import { UploadField } from '../admin/productFormUi';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import { isValidPhone } from '../../lib/contactFields';
import type { CustomerFormValues } from '../../lib/customerProfileFields';
import type { CustomerTileStats } from '../../lib/customerTileStats';
import type { Customer } from '../../types';

export type ImageUploadState = {
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
};

export const EMPTY_CUSTOMER_FORM: CustomerFormValues = {
  name: '',
  phone: '',
  email: '',
  address: '',
  pincode: '',
  state: '',
  district: '',
  latitude: '',
  longitude: '',
};

export const EMPTY_IMAGE_UPLOAD_STATE: ImageUploadState = {
  file: null,
  uploading: false,
  progress: 0,
};

type CustomerFormFieldsProps = {
  mode: 'create' | 'edit';
  values: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  shopPhoto: ImageUploadState;
  onShopPhotoSelect: (file: File) => void;
  onShopPhotoRemove: () => void;
  submitting: boolean;
  existingCustomerWithPhone?: { name: string } | null;
  lookup?: {
    customers: Customer[];
    selectedCustomerId?: string;
    onSelectCustomer: (customer: Customer) => void;
  };
  /** When false on an existing customer, fields look editable but stay locked until edit is enabled. */
  editing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSave?: () => void;
  tileStats?: CustomerTileStats;
  deviceCount?: number;
};

export const CustomerFormFields: React.FC<CustomerFormFieldsProps> = ({
  mode,
  values,
  onChange,
  shopPhoto,
  onShopPhotoSelect,
  onShopPhotoRemove,
  submitting,
  existingCustomerWithPhone = null,
  lookup,
  editing = mode === 'create',
  onStartEdit,
  onCancelEdit,
  onSave,
  tileStats,
  deviceCount = 0,
}) => {
  const shopPhotoRef = useRef<HTMLInputElement>(null);
  const showEditToolbar = mode === 'edit' && onStartEdit && onCancelEdit && onSave;
  const isViewMode = mode === 'edit' && !editing;

  const handleShopPhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onShopPhotoSelect(file);
  };

  const duplicateNotice =
    mode === 'create' && isValidPhone(values.phone) && existingCustomerWithPhone ? (
      <p className="customer-phone-duplicate-notice text-sm m-0 mt-1 px-1" role="alert">
        A customer with this phone number already exists
        {existingCustomerWithPhone.name.trim()
          ? ` (${existingCustomerWithPhone.name.trim()}).`
          : '.'}
      </p>
    ) : null;

  return (
    <div
      className={`customer-form-flat customer-form-party-layout${
        editing ? ' customer-form-party-layout--editing' : ' customer-form-party-layout--locked'
      }`}
    >
      {showEditToolbar && (
        <div className="customer-form-toolbar-row">
          <CustomerFormEditToolbar
            editing={editing}
            onStartEdit={onStartEdit}
            onSave={onSave}
            onCancelEdit={onCancelEdit}
            saving={submitting}
            disabled={submitting}
          />
        </div>
      )}

      <PartyInformationForm
        title="Customer information"
        values={values}
        onChange={onChange}
        disabled={submitting || isViewMode}
        readOnly={isViewMode}
        compact
        hideHeader
        locationCapture
        showEmail
        pincodeRequired={true}
        lookup={isViewMode ? undefined : lookup}
        footer={isViewMode ? null : duplicateNotice}
        heroPhoto={
          <UploadField
            label="Shop photo"
            hint="Optional"
            file={shopPhoto.file}
            uploading={shopPhoto.uploading}
            progress={shopPhoto.progress}
            accept="image/jpeg,image/png,image/webp,image/gif"
            uploadLabel="Upload"
            formats="Max 15 MB"
            inputRef={shopPhotoRef}
            onSelect={handleShopPhotoInput}
            onRemove={onShopPhotoRemove}
            submitting={submitting}
            variant="image"
            compact
            iconActions
            hideLabel
            readOnly={isViewMode}
          />
        }
      />

      {mode === 'edit' && tileStats && (
        <CustomerStatsTiles deviceCount={deviceCount} stats={tileStats} />
      )}
    </div>
  );
};
