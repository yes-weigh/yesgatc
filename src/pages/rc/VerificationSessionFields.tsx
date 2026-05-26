import React, { useMemo, useState } from 'react';
import { CustomerSelect } from '../../components/CustomerSelect';
import { CustomerDetailsSpecs } from '../../components/CustomerDetailsSpecs';
import type { Customer, JobType } from '../../types';
import {
  deviceRowsFromCustomer,
  syncVerificationDevicesAfterCustomerUpdate,
  type DeviceVerificationImagesState,
  type VerificationDeviceRowValues,
  type VerificationSessionValues,
} from '../../lib/siteCalibrationProfileFields';
import { applyLaboratorySealToDeviceRows } from '../../lib/rcLaboratoryFields';
import {
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import { lookupWeatherByPincode } from '../../lib/pincodeWeatherLookup';
import { useAppContext } from '../../context/AppContext';
import { VerificationDeviceFields } from './VerificationDeviceFields';
import { CustomerInlineEditPanel } from './CustomerInlineEditPanel';

type VerificationSessionFieldsProps = {
  values: VerificationSessionValues;
  onChange: (patch: Partial<VerificationSessionValues>) => void;
  onCustomerChange: (
    customerId: string,
    customerName: string,
    devices: VerificationDeviceRowValues[],
    options?: { preserveDeviceImages?: boolean },
  ) => void;
  deviceImages: Record<string, DeviceVerificationImagesState>;
  onDeviceChange: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  onDeviceImageSelect: (localId: string, kind: VerificationImageKind, file: File) => void;
  onDeviceImageRemove: (localId: string, kind: VerificationImageKind) => void;
  customers: Customer[];
  submitting: boolean;
  lockCustomer?: boolean;
  readOnly?: boolean;
  laboratorySealIdentification?: string;
  onCustomerUpdated?: (customer: Customer) => void;
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
  onDeviceImageSelect,
  onDeviceImageRemove,
  customers,
  submitting,
  lockCustomer = false,
  readOnly = false,
  laboratorySealIdentification = '',
  onCustomerUpdated,
}) => {
  const { products } = useAppContext();
  const locked = submitting || readOnly;

  const withLaboratorySeal = (devices: VerificationDeviceRowValues[]) => {
    if (readOnly || !laboratorySealIdentification.trim()) return devices;
    return applyLaboratorySealToDeviceRows(devices, laboratorySealIdentification.trim());
  };
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [editingCustomer, setEditingCustomer] = useState(false);

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === values.customerId) ?? null,
    [customers, values.customerId],
  );

  const prefillWeatherForCustomer = async (customer: Customer | null) => {
    if (!customer?.pincode?.trim()) {
      setWeatherError('');
      return;
    }

    setWeatherLoading(true);
    setWeatherError('');

    try {
      const weather = await lookupWeatherByPincode({
        pincode: customer.pincode,
        location: customer.location,
      });

      if (weather) {
        onChange({
          ambientTemperature: weather.ambientTemperature,
          relativeHumidity: weather.relativeHumidity,
        });
      } else {
        setWeatherError('Could not fetch weather for this postal code. Enter values manually.');
      }
    } catch {
      setWeatherError('Could not fetch weather for this postal code. Enter values manually.');
    } finally {
      setWeatherLoading(false);
    }
  };

  const handleCustomerSelect = (next: { customerId: string; customerName: string }) => {
    if (lockCustomer) return;
    setEditingCustomer(false);
    const customer = customers.find(c => c.id === next.customerId) ?? null;
    const existingNewDevices = values.devices.filter(d => d.isNewDevice);
    const registeredRows = withLaboratorySeal(deviceRowsFromCustomer(customer, products));
    const devices = withLaboratorySeal([...registeredRows, ...existingNewDevices]);
    onCustomerChange(next.customerId, next.customerName, devices);
    onChange({
      customerId: next.customerId,
      customerName: next.customerName,
      devices,
      ambientTemperature: '',
      relativeHumidity: '',
    });
    void prefillWeatherForCustomer(customer);
  };

  const handleCustomerSaved = (updated: Customer) => {
    const mergedDevices = withLaboratorySeal(
      syncVerificationDevicesAfterCustomerUpdate(values.devices, updated, products),
    );
    onCustomerUpdated?.(updated);
    onCustomerChange(updated.id, updated.name, mergedDevices, { preserveDeviceImages: true });
    onChange({
      customerId: updated.id,
      customerName: updated.name,
      devices: mergedDevices,
    });
    setEditingCustomer(false);

    const pinChanged = updated.pincode?.trim() !== selectedCustomer?.pincode?.trim();
    if (pinChanged) {
      void prefillWeatherForCustomer(updated);
    }
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
                  disabled={locked}
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
              disabled={locked || lockCustomer}
            />
          </div>

          {selectedCustomer && editingCustomer && !readOnly && (
            <CustomerInlineEditPanel
              customer={selectedCustomer}
              onSaved={handleCustomerSaved}
              onClose={() => setEditingCustomer(false)}
            />
          )}

          {selectedCustomer && !editingCustomer && (
            <CustomerDetailsSpecs
              customer={selectedCustomer}
              showDevices={false}
              onEdit={readOnly || lockCustomer ? undefined : () => setEditingCustomer(true)}
              editDisabled={locked}
            />
          )}

          <div className="form-group mb-0">
            <label htmlFor="verification-temp">Ambient temperature (°C)</label>
            <input
              id="verification-temp"
              type="text"
              inputMode="decimal"
              className="input-field"
              placeholder={weatherLoading ? 'Fetching weather…' : 'e.g. 28.5'}
              value={values.ambientTemperature}
              onChange={e => onChange({ ambientTemperature: e.target.value })}
              disabled={locked || weatherLoading}
            />
            <p className="text-muted text-xs mt-1 mb-0">
              {readOnly
                ? 'Recorded at verification time.'
                : weatherLoading
                  ? 'Prefilling from weather based on customer postal code…'
                  : 'Required for submit. Auto-filled from weather when a customer is selected.'}
            </p>
            {weatherError && (
              <p className="text-orange text-xs mt-1 mb-0" role="alert">{weatherError}</p>
            )}
          </div>

          <div className="form-group mb-0">
            <label htmlFor="verification-humidity">Relative humidity (%)</label>
            <input
              id="verification-humidity"
              type="text"
              inputMode="decimal"
              className="input-field"
              placeholder={weatherLoading ? 'Fetching weather…' : 'e.g. 65'}
              value={values.relativeHumidity}
              onChange={e => onChange({ relativeHumidity: e.target.value })}
              disabled={locked || weatherLoading}
            />
            <p className="text-muted text-xs mt-1 mb-0">
              {readOnly ? 'Recorded at verification time.' : 'Required for submit.'}
            </p>
          </div>

          {values.customerId && (
            <div className="site-calibration-form-span-full">
              <VerificationDeviceFields
                devices={values.devices}
                deviceImages={deviceImages}
                onDeviceChange={onDeviceChange}
                onDeviceAdd={onDeviceAdd}
                onDeviceRemove={onDeviceRemove}
                onDeviceImageSelect={onDeviceImageSelect}
                onDeviceImageRemove={onDeviceImageRemove}
                submitting={submitting}
                readOnly={readOnly}
                laboratorySealIdentification={laboratorySealIdentification}
                createMode={!lockCustomer && !readOnly}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
