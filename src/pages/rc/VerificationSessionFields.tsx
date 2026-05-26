import React, { useMemo } from 'react';
import { CustomerSelect } from '../../components/CustomerSelect';
import { CustomerDetailsSpecs } from '../../components/CustomerDetailsSpecs';
import type { Customer, JobType } from '../../types';
import {
  deviceRowsFromCustomer,
  type DeviceScaleImageState,
  type VerificationDeviceRowValues,
  type VerificationSessionValues,
} from '../../lib/siteCalibrationProfileFields';
import { useAppContext } from '../../context/AppContext';
import { VerificationDeviceFields } from './VerificationDeviceFields';

type VerificationSessionFieldsProps = {
  values: VerificationSessionValues;
  onChange: (patch: Partial<VerificationSessionValues>) => void;
  onCustomerChange: (customerId: string, customerName: string, devices: VerificationDeviceRowValues[]) => void;
  deviceImages: Record<string, DeviceScaleImageState>;
  onDeviceChange: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  onScaleImageSelect: (localId: string, file: File) => void;
  onScaleImageRemove: (localId: string) => void;
  customers: Customer[];
  submitting: boolean;
  lockCustomer?: boolean;
  lockExistingDevices?: boolean;
};

const VERIFICATION_OPTIONS: { value: JobType; label: string }[] = [
  { value: 'OV', label: 'Original Verification' },
  { value: 'RV', label: 'Re-verification' },
];

export const VerificationSessionFields: React.FC<VerificationSessionFieldsProps> = ({
  values,
  onChange,
  onCustomerChange,
  deviceImages,
  onDeviceChange,
  onDeviceAdd,
  onDeviceRemove,
  onScaleImageSelect,
  onScaleImageRemove,
  customers,
  submitting,
  lockCustomer = false,
  lockExistingDevices = false,
}) => {
  const { products } = useAppContext();

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === values.customerId) ?? null,
    [customers, values.customerId],
  );

  const handleCustomerSelect = (next: { customerId: string; customerName: string }) => {
    if (lockCustomer) return;
    const customer = customers.find(c => c.id === next.customerId) ?? null;
    const existingNewDevices = values.devices.filter(d => d.isNewDevice);
    const registeredRows = deviceRowsFromCustomer(customer, products);
    onCustomerChange(next.customerId, next.customerName, [...registeredRows, ...existingNewDevices]);
    onChange({
      customerId: next.customerId,
      customerName: next.customerName,
      devices: [...registeredRows, ...existingNewDevices],
    });
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
            <label htmlFor="verification-customer">Customer *</label>
            <CustomerSelect
              customers={customers}
              inputId="verification-customer"
              value={{
                customerId: values.customerId,
                customerName: values.customerName,
              }}
              onChange={handleCustomerSelect}
              disabled={submitting || lockCustomer}
              required
            />
          </div>

          {selectedCustomer && (
            <CustomerDetailsSpecs customer={selectedCustomer} showDevices={false} />
          )}

          <div className="form-group mb-0">
            <label htmlFor="verification-temp">Ambient temperature (°C) *</label>
            <input
              id="verification-temp"
              type="text"
              inputMode="decimal"
              className="input-field"
              placeholder="e.g. 28.5"
              value={values.ambientTemperature}
              onChange={e => onChange({ ambientTemperature: e.target.value })}
              disabled={submitting}
              required
            />
            <p className="text-muted text-xs mt-1 mb-0">Shared for all devices at this visit.</p>
          </div>

          <div className="form-group mb-0">
            <label htmlFor="verification-humidity">Relative humidity (%) *</label>
            <input
              id="verification-humidity"
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

          {values.customerId && (
            <div className="site-calibration-form-span-full">
              <VerificationDeviceFields
                devices={values.devices}
                deviceImages={deviceImages}
                onDeviceChange={onDeviceChange}
                onDeviceAdd={onDeviceAdd}
                onDeviceRemove={onDeviceRemove}
                onScaleImageSelect={onScaleImageSelect}
                onScaleImageRemove={onScaleImageRemove}
                submitting={submitting}
                lockExistingDevices={lockExistingDevices}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
