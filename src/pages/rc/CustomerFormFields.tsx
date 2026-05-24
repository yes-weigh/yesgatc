import React, { useRef, useState } from 'react';
import { Crosshair, MapPin, X } from 'lucide-react';
import { UploadField } from '../admin/productFormUi';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import { normalizePhone, normalizePincode } from '../../lib/contactFields';
import type { CustomerFormValues } from '../../lib/customerProfileFields';

export type CustomerPhotoUploadState = {
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
  latitude: '',
  longitude: '',
};

export const EMPTY_CUSTOMER_PHOTO_STATE: CustomerPhotoUploadState = {
  file: null,
  uploading: false,
  progress: 0,
};

type CustomerFormFieldsProps = {
  mode: 'create' | 'edit';
  values: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  customerPhoto: CustomerPhotoUploadState;
  onPhotoSelect: (file: File) => void;
  onPhotoRemove: () => void;
  submitting: boolean;
};

export const CustomerFormFields: React.FC<CustomerFormFieldsProps> = ({
  mode,
  values,
  onChange,
  customerPhoto,
  onPhotoSelect,
  onPhotoRemove,
  submitting,
}) => {
  const photoRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  const handlePhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onPhotoSelect(file);
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
        <div className="customer-form-hero-photo">
          <UploadField
            label="Customer photo"
            hint="Optional"
            file={customerPhoto.file}
            uploading={customerPhoto.uploading}
            progress={customerPhoto.progress}
            accept="image/jpeg,image/png,image/webp,image/gif"
            uploadLabel="Upload"
            formats="Max 15 MB"
            inputRef={photoRef}
            onSelect={handlePhotoInput}
            onRemove={onPhotoRemove}
            submitting={submitting}
            variant="image"
            compact
            avatar
          />
        </div>

        <div className="customer-form-hero-fields">
          <div className="customer-form-grid customer-form-grid--identity">
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
                autoFocus={mode === 'create'}
              />
            </div>
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
            <div className="form-group mb-0">
              <label htmlFor="customer-pincode">Postal code</label>
              <input
                id="customer-pincode"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="Optional"
                value={values.pincode}
                onChange={e => onChange({ pincode: normalizePincode(e.target.value) })}
                maxLength={6}
              />
            </div>
            <div className="form-group mb-0 customer-form-span-full">
              <label htmlFor="customer-address">Address *</label>
              <input
                id="customer-address"
                type="text"
                className="input-field"
                placeholder="Street, locality, city, state"
                value={values.address}
                onChange={e => onChange({ address: e.target.value })}
                required
              />
            </div>
          </div>
        </div>
      </div>

      <div className="product-form-flat-row customer-form-row-location">
        <div className="customer-form-location-head">
          <div>
            <h3 className="customer-form-location-title">
              <MapPin size={15} className="inline-icon-sm" /> GPS location
            </h3>
            <p className="customer-form-location-hint text-muted text-sm m-0">
              Optional — pin the customer site for calibration visits
            </p>
          </div>
          <div className="customer-form-location-actions">
            <button
              type="button"
              className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
              onClick={handleDetectLocation}
              disabled={submitting || locating}
            >
              {locating ? (
                <span className="spinner-inline"></span>
              ) : (
                <Crosshair size={14} />
              )}
              Use my location
            </button>
            {hasLocation && (
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
                onClick={handleClearLocation}
                disabled={submitting || locating}
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>
        </div>

        {locationError && (
          <p className="customer-form-location-error text-sm" role="alert">
            {locationError}
          </p>
        )}

        <div className="customer-form-grid customer-form-grid--location">
          <div className="form-group mb-0">
            <label htmlFor="customer-latitude">Latitude</label>
            <input
              id="customer-latitude"
              type="text"
              inputMode="decimal"
              className="input-field"
              placeholder="e.g. 18.520430"
              value={values.latitude}
              onChange={e => onChange({ latitude: e.target.value })}
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="customer-longitude">Longitude</label>
            <input
              id="customer-longitude"
              type="text"
              inputMode="decimal"
              className="input-field"
              placeholder="e.g. 73.856744"
              value={values.longitude}
              onChange={e => onChange({ longitude: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
