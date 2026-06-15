import React, { useMemo, useRef } from 'react';
import { ProductSelect } from '../../components/ProductSelect';
import { CustomerSelect } from '../../components/CustomerSelect';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import { CustomerDetailsSpecs } from '../../components/CustomerDetailsSpecs';
import { UploadField } from '../admin/productFormUi';
import { useAppContext } from '../../context/AppContext';
import type { Customer, JobType } from '../../types';
import {
  mpeStringFromProduct,
  type SiteCalibrationFormValues,
} from '../../lib/siteCalibrationProfileFields';
import { type ImageUploadState } from './CustomerFormFields';

type SiteCalibrationFormFieldsProps = {
  values: SiteCalibrationFormValues;
  onChange: (patch: Partial<SiteCalibrationFormValues>) => void;
  customers: Customer[];
  scaleImage: ImageUploadState;
  onScaleImageSelect: (file: File) => void;
  onScaleImageRemove: () => void;
  submitting: boolean;
};

const VERIFICATION_OPTIONS: { value: JobType; label: string }[] = [
  { value: 'OV', label: 'Original Verification' },
  { value: 'RV', label: 'Re-verification' },
];

export const SiteCalibrationFormFields: React.FC<SiteCalibrationFormFieldsProps> = ({
  values,
  onChange,
  customers,
  scaleImage,
  onScaleImageSelect,
  onScaleImageRemove,
  submitting,
}) => {
  const { products } = useAppContext();
  const scaleImageRef = useRef<HTMLInputElement>(null);

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === values.customerId) ?? null,
    [customers, values.customerId],
  );

  const selectedProduct = useMemo(
    () => products.find(p => p.id === values.productId) ?? null,
    [products, values.productId],
  );

  const handleScaleImageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onScaleImageSelect(file);
  };

  return (
    <div className="product-form-flat site-calibration-form-flat">
      <div className="product-form-flat-row site-calibration-form-row">
        <fieldset className="site-calibration-type-field mb-0">
          <legend className="form-group-label">Verification type *</legend>
          <div className="site-calibration-type-options">
            {VERIFICATION_OPTIONS.map(opt => (
              <label key={opt.value} className="site-calibration-type-option">
                <input
                  type="radio"
                  name="verificationType"
                  value={opt.value}
                  checked={values.verificationType === opt.value}
                  onChange={() => onChange({ verificationType: opt.value })}
                  disabled={submitting}
                  required
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="site-calibration-form-grid">
          <div className="form-group mb-0 site-calibration-form-span-full">
            <label htmlFor="site-calibration-customer">Customer *</label>
            <CustomerSelect
              customers={customers}
              inputId="site-calibration-customer"
              value={{
                customerId: values.customerId,
                customerName: values.customerName,
              }}
              onChange={next => onChange({ customerId: next.customerId, customerName: next.customerName })}
              disabled={submitting}
              required
            />
          </div>

          {selectedCustomer && <CustomerDetailsSpecs customer={selectedCustomer} />}

          <div className="form-group mb-0 site-calibration-form-span-full">
            <label htmlFor="site-calibration-product">Product *</label>
            <ProductSelect
              products={products}
              inputId="site-calibration-product"
              value={{
                productId: values.productId,
                productName: values.productName,
              }}
              onChange={next => {
                const product = products.find(p => p.id === next.productId) ?? null;
                onChange({
                  productId: next.productId,
                  productName: next.productName,
                  maximumPermissibleError: mpeStringFromProduct(product),
                });
              }}
              disabled={submitting}
              required
            />
          </div>

          {selectedProduct && (
            <ProductDetailsSpecs product={selectedProduct} className="site-calibration-form-span-full" />
          )}

          <div className="form-group mb-0">
            <label htmlFor="site-calibration-serial">Serial number *</label>
            <input
              id="site-calibration-serial"
              type="text"
              className="input-field"
              placeholder="e.g. SN-12345"
              value={values.serialNumber}
              onChange={e => onChange({ serialNumber: e.target.value })}
              disabled={submitting}
              required
            />
          </div>

          <div className="form-group mb-0">
            <label htmlFor="site-calibration-mpe">MPE</label>
            <input
              id="site-calibration-mpe"
              type="number"
              step="any"
              className="input-field"
              placeholder="From product"
              value={values.maximumPermissibleError}
              onChange={e => onChange({ maximumPermissibleError: e.target.value })}
              disabled={submitting}
            />
            <p className="text-muted text-xs mt-1 mb-0">
              Pre-filled from the selected product; edit if this calibration uses a different value.
            </p>
          </div>

          <div className="form-group mb-0">
            <label htmlFor="site-calibration-temp">Ambient temperature (°C) *</label>
            <input
              id="site-calibration-temp"
              type="text"
              inputMode="decimal"
              className="input-field"
              placeholder="e.g. 28.5"
              value={values.ambientTemperature}
              onChange={e => onChange({ ambientTemperature: e.target.value })}
              disabled={submitting}
              required
            />
          </div>

          <div className="form-group mb-0">
            <label htmlFor="site-calibration-humidity">Relative humidity (%) *</label>
            <input
              id="site-calibration-humidity"
              type="text"
              inputMode="decimal"
              className="input-field"
              placeholder="e.g. 65"
              value={values.relativeHumidity}
              onChange={e => onChange({ relativeHumidity: e.target.value })}
              disabled={submitting}
              required
            />
          </div>

          <div className="form-group mb-0 site-calibration-form-span-full">
            <label htmlFor="site-calibration-seal">Seal identification number</label>
            <input
              id="site-calibration-seal"
              type="text"
              className="input-field input-readonly"
              value={values.sealIdentificationNumber}
              readOnly
              tabIndex={-1}
              aria-readonly
            />
          </div>

          <div className="form-group mb-0 site-calibration-form-span-full site-calibration-scale-image-field">
            <UploadField
              label="Scale image"
              hint="Required"
              file={scaleImage.file}
              uploading={scaleImage.uploading}
              progress={scaleImage.progress}
              accept="image/jpeg,image/png,image/webp,image/gif"
              uploadLabel="Upload"
              formats="Max 15 MB"
              inputRef={scaleImageRef}
              onSelect={handleScaleImageInput}
              onRemove={onScaleImageRemove}
              submitting={submitting}
              variant="image"
              compact
              iconActions
            />
          </div>
        </div>
      </div>
    </div>
  );
};
