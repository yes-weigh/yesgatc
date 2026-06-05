import React, { useRef } from 'react';
import { ClipboardList, Package } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CustomerFormEditToolbar } from '../../components/CustomerFormEditToolbar';
import { PartyInformationForm } from '../../components/PartyInformationForm';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import { StorageImage } from '../../components/StorageImage';
import { useAppContext } from '../../context/AppContext';
import type { CustomerDeviceFormValues, CustomerFormValues } from '../../lib/customerProfileFields';
import {
  resolveAppBasePath,
  verificationUrlForCustomer,
} from '../../lib/verificationCustomerEntry';
import { UploadField } from '../admin/productFormUi';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import { isValidPhone } from '../../lib/contactFields';
import type { Customer, Product } from '../../types';

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

export type CustomerDeviceRowState = {
  row: CustomerDeviceFormValues;
};

const DeviceDisplayRow: React.FC<{
  index: number;
  device: CustomerDeviceFormValues;
  products: Product[];
}> = ({ index, device, products }) => {
  const selectedProduct = products.find(p => p.id === device.productId) ?? null;
  const productName = device.productName.trim() || '—';
  const serialNumber = device.serialNumber.trim() || '—';

  return (
    <div className="customer-device-row">
      <div className="customer-device-row-head">
        <span className="customer-device-index">Device {index + 1}</span>
      </div>
      <div className="customer-device-fields">
        <div className="customer-device-product-specs">
          <div className="customer-device-product-specs-grid">
            <div className="customer-device-thumb">
              <div
                className={`customer-device-thumb-box${
                  !selectedProduct?.productImageUrl && !selectedProduct?.productImagePath
                    ? ' customer-device-thumb-box--placeholder'
                    : ''
                }`}
              >
                {selectedProduct?.productImageUrl || selectedProduct?.productImagePath ? (
                  <StorageImage
                    url={selectedProduct.productImageUrl}
                    path={selectedProduct.productImagePath}
                    alt=""
                    className="customer-device-thumb-img"
                  />
                ) : (
                  <Package size={22} className="text-muted" aria-hidden />
                )}
              </div>
            </div>

            <div className="customer-device-spec-item">
              <span className="customer-device-spec-label">Product</span>
              <span className="customer-device-spec-value">{productName}</span>
            </div>

            <div className="customer-device-spec-item">
              <span className="customer-device-spec-label">Serial number</span>
              <span className="customer-device-spec-value customer-device-spec-value--mono">
                {serialNumber}
              </span>
            </div>

            {selectedProduct ? (
              <ProductDetailsSpecs
                product={selectedProduct}
                embedded
                className="customer-device-product-details"
              />
            ) : (
              <p className="customer-form-devices-empty text-muted text-sm m-0">
                Product details unavailable — catalogue entry not found.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

type CustomerFormFieldsProps = {
  mode: 'create' | 'edit';
  values: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  shopPhoto: ImageUploadState;
  onShopPhotoSelect: (file: File) => void;
  onShopPhotoRemove: () => void;
  devices: CustomerDeviceRowState[];
  submitting: boolean;
  existingCustomerWithPhone?: { name: string } | null;
  lookup?: {
    customers: Customer[];
    selectedCustomerId?: string;
    onSelectCustomer: (customer: Customer) => void;
  };
  /** When false on an existing customer, the form shows read-only values until edit is enabled. */
  editing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSave?: () => void;
  /** Opens verification flow with this customer pre-selected. */
  customerId?: string;
};

export const CustomerFormFields: React.FC<CustomerFormFieldsProps> = ({
  mode,
  values,
  onChange,
  shopPhoto,
  onShopPhotoSelect,
  onShopPhotoRemove,
  devices,
  submitting,
  existingCustomerWithPhone = null,
  lookup,
  editing = mode === 'create',
  onStartEdit,
  onCancelEdit,
  onSave,
  customerId,
}) => {
  const { products } = useAppContext();
  const shopPhotoRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const showEditToolbar = mode === 'edit' && onStartEdit && onCancelEdit && onSave;
  const isViewMode = mode === 'edit' && !editing;

  const handleShopPhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onShopPhotoSelect(file);
  };

  const handleOpenVerification = () => {
    if (!customerId) return;
    const base = resolveAppBasePath(location.pathname);
    navigate(verificationUrlForCustomer(customerId, base));
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
        isViewMode ? ' customer-form-party-layout--readonly' : ''
      }${editing ? ' customer-form-party-layout--editing' : ''}`}
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
        pincodeRequired={false}
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

      {mode === 'edit' && customerId && (
        <div className="customer-form-row-devices">
          <div className="customer-form-devices-head">
            <div>
              <h3 className="customer-form-devices-title">Devices</h3>
              <p className="customer-form-devices-hint text-muted text-sm m-0">
                Registered at this site — manage devices through verification
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5 shrink-0 customer-form-verification-btn"
              onClick={handleOpenVerification}
              disabled={submitting}
            >
              <ClipboardList size={14} /> New verification
            </button>
          </div>

          {devices.length === 0 ? (
            <p className="customer-form-devices-empty text-muted text-sm m-0">
              No devices on file yet. Start a verification to register instruments at this customer site.
            </p>
          ) : (
            <div className="customer-form-devices-list">
              {devices.map((device, index) => (
                <DeviceDisplayRow
                  key={device.row.localId}
                  index={index}
                  device={device.row}
                  products={products}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
