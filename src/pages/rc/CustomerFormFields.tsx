import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, MapPin, Plus, Trash2, X } from 'lucide-react';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import { ProductSelect } from '../../components/ProductSelect';
import { useAppContext } from '../../context/AppContext';
import { UploadField } from '../admin/productFormUi';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import { isValidPincode, isValidPhone, normalizePhone, normalizePincode } from '../../lib/contactFields';
import type { CustomerDeviceFormValues, CustomerFormValues } from '../../lib/customerProfileFields';
import { lookupPincode } from '../../lib/pincodeLookup';
import type { Product } from '../../types';

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

const DeviceRow: React.FC<{
  index: number;
  device: CustomerDeviceRowState;
  products: Product[];
  submitting: boolean;
  onChange: (localId: string, patch: Partial<CustomerDeviceFormValues>) => void;
  onRemove: (localId: string) => void;
}> = ({ index, device, products, submitting, onChange, onRemove }) => {
  const selectedProduct = products.find(p => p.id === device.row.productId) ?? null;

  return (
    <div className="customer-device-row">
      <div className="customer-device-row-head">
        <span className="customer-device-index">Device {index + 1}</span>
        <button
          type="button"
          className="btn-icon text-red customer-device-remove"
          onClick={() => onRemove(device.row.localId)}
          disabled={submitting}
          title="Remove device"
          aria-label={`Remove device ${index + 1}`}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="customer-device-fields">
        <div className="form-group mb-0 customer-device-product-field">
          <label htmlFor={`device-product-${device.row.localId}`}>Product *</label>
          <ProductSelect
            products={products}
            inputId={`device-product-${device.row.localId}`}
            value={{
              productId: device.row.productId,
              productName: device.row.productName,
            }}
            onChange={next =>
              onChange(device.row.localId, {
                productId: next.productId,
                productName: next.productName,
              })
            }
            disabled={submitting}
            required
          />
        </div>
        {selectedProduct && <ProductDetailsSpecs product={selectedProduct} />}
        <div className="form-group mb-0 customer-device-serial-field">
          <label htmlFor={`device-serial-${device.row.localId}`}>Serial number *</label>
          <input
            id={`device-serial-${device.row.localId}`}
            type="text"
            className="input-field"
            placeholder="e.g. SN-12345"
            value={device.row.serialNumber}
            onChange={e => onChange(device.row.localId, { serialNumber: e.target.value })}
            required
          />
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
  onDeviceChange: (localId: string, patch: Partial<CustomerDeviceFormValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  submitting: boolean;
  existingCustomerWithPhone?: { name: string } | null;
};

export const CustomerFormFields: React.FC<CustomerFormFieldsProps> = ({
  mode,
  values,
  onChange,
  shopPhoto,
  onShopPhotoSelect,
  onShopPhotoRemove,
  devices,
  onDeviceChange,
  onDeviceAdd,
  onDeviceRemove,
  submitting,
  existingCustomerWithPhone = null,
}) => {
  const { products } = useAppContext();
  const shopPhotoRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [pincodeLookupLoading, setPincodeLookupLoading] = useState(false);
  const [pincodeLookupError, setPincodeLookupError] = useState('');
  const lastPincodeLookupRef = useRef('');

  useEffect(() => {
    const pin = normalizePincode(values.pincode);

    if (!isValidPincode(pin)) {
      lastPincodeLookupRef.current = '';
      setPincodeLookupLoading(false);
      setPincodeLookupError('');
      if (values.state || values.district) {
        onChange({ state: '', district: '' });
      }
      return;
    }

    if (lastPincodeLookupRef.current === pin) return;

    if (values.state.trim() && values.district.trim()) {
      lastPincodeLookupRef.current = pin;
      return;
    }

    let cancelled = false;
    lastPincodeLookupRef.current = pin;
    setPincodeLookupLoading(true);
    setPincodeLookupError('');

    lookupPincode(pin)
      .then(result => {
        if (cancelled) return;
        if (result) {
          onChange({ state: result.state, district: result.district });
          setPincodeLookupError('');
        } else {
          onChange({ state: '', district: '' });
          setPincodeLookupError('No location found for this postal code.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        onChange({ state: '', district: '' });
        setPincodeLookupError('Could not look up postal code.');
      })
      .finally(() => {
        if (!cancelled) setPincodeLookupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [values.pincode, onChange]);

  const handlePincodeChange = (raw: string) => {
    const next = normalizePincode(raw);
    const prev = normalizePincode(values.pincode);
    const patch: Partial<CustomerFormValues> = { pincode: next };
    if (next !== prev) {
      patch.state = '';
      patch.district = '';
      lastPincodeLookupRef.current = '';
      setPincodeLookupError('');
    }
    onChange(patch);
  };

  const handleShopPhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onShopPhotoSelect(file);
  };

  const handleDetectLocation = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        onChange({
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        });
        setLocating(false);
      },
      err => {
        setLocating(false);
        setLocationError(err.message || 'Could not detect location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const handleClearLocation = () => {
    setLocationError('');
    onChange({ latitude: '', longitude: '' });
  };

  const hasLocation = Boolean(values.latitude.trim() && values.longitude.trim());

  return (
    <div className="product-form-flat customer-form-flat">
      <div className="product-form-flat-row customer-form-hero">
        <div className="customer-form-hero-shop">
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
          />
        </div>

        <div className="customer-form-hero-fields">
          <div className="customer-form-grid customer-form-grid--identity">
            <div className="form-group mb-0">
              <label htmlFor="customer-phone">Mobile *</label>
              <input
                id="customer-phone"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="10-digit"
                value={values.phone}
                onChange={e => onChange({ phone: normalizePhone(e.target.value) })}
                required
                maxLength={10}
                autoFocus={mode === 'create'}
              />
              {mode === 'create' && isValidPhone(values.phone) && existingCustomerWithPhone && (
                <p className="customer-phone-duplicate-notice text-sm m-0 mt-1" role="alert">
                  A customer with this phone number already exists
                  {existingCustomerWithPhone.name.trim()
                    ? ` (${existingCustomerWithPhone.name.trim()}).`
                    : '.'}
                </p>
              )}
            </div>
            <div className="form-group mb-0">
              <label htmlFor="customer-name">Name *</label>
              <input
                id="customer-name"
                type="text"
                className="input-field"
                placeholder="Customer or business name"
                value={values.name}
                onChange={e => onChange({ name: e.target.value })}
                required
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="customer-email">Email</label>
              <input
                id="customer-email"
                type="email"
                className="input-field"
                placeholder="Optional"
                value={values.email}
                onChange={e => onChange({ email: e.target.value })}
              />
            </div>
            <div className="form-group mb-0 customer-form-pincode-field">
              <label htmlFor="customer-pincode">Postal code</label>
              <input
                id="customer-pincode"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="6 digits"
                value={values.pincode}
                onChange={e => handlePincodeChange(e.target.value)}
                maxLength={6}
              />
              {pincodeLookupLoading && (
                <p className="customer-pincode-meta text-muted text-sm m-0 mt-1 flex items-center gap-1.5">
                  <span className="spinner-inline"></span> Looking up location…
                </p>
              )}
              {!pincodeLookupLoading && pincodeLookupError && (
                <p className="customer-pincode-meta customer-pincode-meta--error text-sm m-0 mt-1" role="alert">
                  {pincodeLookupError}
                </p>
              )}
            </div>
            <div className="form-group mb-0">
              <label htmlFor="customer-district">District</label>
              <input
                id="customer-district"
                type="text"
                className="input-field input-readonly customer-form-derived-field"
                value={values.district}
                readOnly
                tabIndex={-1}
                placeholder="Auto from postal code"
                aria-label="District from postal code"
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="customer-state">State</label>
              <input
                id="customer-state"
                type="text"
                className="input-field input-readonly customer-form-derived-field"
                value={values.state}
                readOnly
                tabIndex={-1}
                placeholder="Auto from postal code"
                aria-label="State from postal code"
              />
            </div>
          </div>

          <div className="customer-form-address-row">
            <div className="form-group mb-0 customer-form-address-field">
              <label htmlFor="customer-address">Address *</label>
              <textarea
                id="customer-address"
                className="input-field customer-form-address-input"
                rows={3}
                placeholder="Street, locality, city"
                value={values.address}
                onChange={e => onChange({ address: e.target.value })}
                required
              />
            </div>

            <div className="customer-form-location-side">
              <label className="customer-form-location-side-label">
                <MapPin size={14} className="inline-icon-sm" /> GPS
                <span className="text-muted text-sm font-normal">Optional</span>
              </label>
              <div className="customer-form-location-controls">
                <button
                  type="button"
                  className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5 shrink-0"
                  onClick={handleDetectLocation}
                  disabled={submitting || locating}
                >
                  {locating ? <span className="spinner-inline"></span> : <Crosshair size={14} />}
                  Use my location
                </button>
                {hasLocation && (
                  <button
                    type="button"
                    className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5 shrink-0"
                    onClick={handleClearLocation}
                    disabled={submitting || locating}
                    title="Clear location"
                    aria-label="Clear location"
                  >
                    <X size={14} />
                  </button>
                )}
                <div className="customer-form-location-coords">
                  <input
                    id="customer-latitude"
                    type="text"
                    className="input-field input-field--coords"
                    placeholder="Lat"
                    value={values.latitude}
                    readOnly
                    tabIndex={-1}
                    aria-label="Latitude"
                  />
                  <input
                    id="customer-longitude"
                    type="text"
                    className="input-field input-field--coords"
                    placeholder="Lng"
                    value={values.longitude}
                    readOnly
                    tabIndex={-1}
                    aria-label="Longitude"
                  />
                </div>
              </div>
              {locationError && (
                <p className="customer-form-location-error text-sm" role="alert">
                  {locationError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="product-form-flat-row customer-form-row-devices">
        <div className="customer-form-devices-head">
          <div>
            <h3 className="customer-form-devices-title">Devices</h3>
            <p className="customer-form-devices-hint text-muted text-sm m-0">
              Optional — add weighing instruments at this customer site
            </p>
          </div>
        </div>

        {devices.length === 0 ? (
          <p className="customer-form-devices-empty text-muted text-sm m-0">
            No devices added yet.
          </p>
        ) : (
          <div className="customer-form-devices-list">
            {devices.map((device, index) => (
              <DeviceRow
                key={device.row.localId}
                index={index}
                device={device}
                products={products}
                submitting={submitting}
                onChange={onDeviceChange}
                onRemove={onDeviceRemove}
              />
            ))}
          </div>
        )}

        <div className="customer-form-devices-footer">
          <button
            type="button"
            className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5 shrink-0"
            onClick={onDeviceAdd}
            disabled={submitting}
          >
            <Plus size={14} /> Add device
          </button>
        </div>
      </div>
    </div>
  );
};
