import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CustomerSelect } from '../../components/CustomerSelect';
import { CustomerDetailsSpecs } from '../../components/CustomerDetailsSpecs';
import { RcDetailsSpecs } from '../../components/RcDetailsSpecs';
import type { Customer, FirestoreUserDoc, JobType, VerificationLocation } from '../../types';
import {
  buildInitialSelfDeviceRows,
  deviceRowsFromCustomer,
  syncVerificationDevicesAfterCustomerUpdate,
  VERIFICATION_LOCATION_OPTIONS,
  type DeviceVerificationImagesState,
  type DeviceRvDocumentsState,
  type VerificationDeviceRowValues,
  type VerificationSessionValues,
  type VerificationSubject,
} from '../../lib/siteCalibrationProfileFields';
import { applyLaboratorySealToDeviceRows } from '../../lib/rcLaboratoryFields';
import {
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import type { RvDocumentKind } from '../../lib/verificationRvDeviceImages';
import { resolveRcFeesStructure } from '../../lib/rcProfileFields';
import { lookupWeatherByPincode } from '../../lib/pincodeWeatherLookup';
import { isValidPincode, normalizePincode } from '../../lib/contactFields';
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
  deviceRvImages?: Record<string, DeviceRvDocumentsState>;
  onDeviceChange: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  onDeviceImageSelect: (localId: string, kind: VerificationImageKind, file: File) => void;
  onDeviceImageRemove: (localId: string, kind: VerificationImageKind) => void;
  onDeviceRvDocumentSelect?: (localId: string, kind: RvDocumentKind, file: File) => void;
  onDeviceRvDocumentRemove?: (localId: string, kind: RvDocumentKind) => void;
  customers: Customer[];
  rcProfile: FirestoreUserDoc | null;
  rcUid?: string;
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

const SUBJECT_OPTIONS: { value: VerificationSubject; label: string }[] = [
  { value: 'self', label: 'Self' },
  { value: 'customer', label: 'Customer' },
];

export const VerificationSessionFields: React.FC<VerificationSessionFieldsProps> = ({
  values,
  onChange,
  onCustomerChange,
  deviceImages,
  deviceRvImages = {},
  onDeviceChange,
  onDeviceAdd,
  onDeviceRemove,
  onDeviceImageSelect,
  onDeviceImageRemove,
  onDeviceRvDocumentSelect,
  onDeviceRvDocumentRemove,
  customers,
  rcProfile,
  rcUid,
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
  const lastSelfWeatherKeyRef = useRef('');

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === values.customerId) ?? null,
    [customers, values.customerId],
  );

  const isSelf = values.verificationSubject === 'self';
  const showDevices = isSelf || Boolean(values.customerId);

  const prefillWeather = async (
    pincode: string,
    options?: {
      location?: { lat: number; lng: number };
      district?: string;
      state?: string;
    },
  ): Promise<boolean> => {
    const normalized = normalizePincode(pincode);
    const hasPincode = isValidPincode(normalized);
    const hasLocation = options?.location?.lat != null && options?.location?.lng != null;
    if (!hasPincode && !hasLocation) {
      setWeatherError('');
      return false;
    }

    setWeatherLoading(true);
    setWeatherError('');

    try {
      const weather = await lookupWeatherByPincode({
        pincode: normalized,
        district: options?.district,
        state: options?.state,
        location: hasLocation ? options.location : undefined,
      });

      if (weather) {
        onChange({
          ambientTemperature: weather.ambientTemperature,
          relativeHumidity: weather.relativeHumidity,
        });
        return true;
      }

      setWeatherError('Could not fetch weather for this postal code. Enter values manually.');
      return false;
    } catch {
      setWeatherError('Could not fetch weather for this postal code. Enter values manually.');
      return false;
    } finally {
      setWeatherLoading(false);
    }
  };

  const prefillWeatherForCustomer = async (customer: Customer | null) => {
    await prefillWeather(customer?.pincode ?? '', {
      location: customer?.location,
      district: customer?.district,
      state: customer?.state,
    });
  };

  const prefillWeatherForRc = async (rc: FirestoreUserDoc | null): Promise<boolean> => {
    if (!rc) return false;
    return prefillWeather(rc.pincode ?? '', { location: rc.location });
  };

  const applyCustomerSubject = () => {
    if (lockCustomer) return;
    lastSelfWeatherKeyRef.current = '';
    onCustomerChange('', '', []);
    onChange({
      verificationSubject: 'customer',
      customerId: '',
      customerName: '',
      devices: [],
      ambientTemperature: '',
      relativeHumidity: '',
    });
    setEditingCustomer(false);
    setWeatherError('');
  };

  const applySelfSubject = () => {
    if (!rcProfile || !rcUid || lockCustomer) return;
    const devices = withLaboratorySeal(buildInitialSelfDeviceRows(laboratorySealIdentification));
    onCustomerChange(rcUid, rcProfile.companyName?.trim() || rcProfile.username?.trim() || '', devices);
    onChange({
      verificationSubject: 'self',
      customerId: rcUid,
      customerName: rcProfile.companyName?.trim() || rcProfile.username?.trim() || '',
      devices,
      ambientTemperature: '',
      relativeHumidity: '',
    });
    setEditingCustomer(false);
    setWeatherError('');
  };

  useEffect(() => {
    if (readOnly || lockCustomer || values.verificationSubject !== 'self') {
      lastSelfWeatherKeyRef.current = '';
      return;
    }
    if (values.verificationType === 'RV') return;

    const pincode = normalizePincode(rcProfile?.pincode ?? '');
    const hasPincode = isValidPincode(pincode);
    const hasLocation =
      rcProfile?.location?.lat != null && rcProfile?.location?.lng != null;
    if (!hasPincode && !hasLocation) return;
    if (values.ambientTemperature.trim() || values.relativeHumidity.trim()) return;

    const locKey = hasLocation
      ? `${rcProfile!.location!.lat},${rcProfile!.location!.lng}`
      : '';
    const key = `${pincode}:${locKey}:${values.customerId || rcUid || ''}`;
    if (lastSelfWeatherKeyRef.current === key) return;

    void (async () => {
      const ok = await prefillWeatherForRc(rcProfile);
      if (ok) lastSelfWeatherKeyRef.current = key;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill when self session or RC pincode becomes available
  }, [
    readOnly,
    lockCustomer,
    values.verificationSubject,
    values.ambientTemperature,
    values.relativeHumidity,
    values.customerId,
    rcProfile?.pincode,
    rcProfile?.location?.lat,
    rcProfile?.location?.lng,
    rcUid,
    values.verificationType,
  ]);

  const handleSubjectChange = (subject: VerificationSubject) => {
    if (lockCustomer || subject === values.verificationSubject) return;
    if (subject === 'self') {
      if (values.verificationType === 'RV') return;
      lastSelfWeatherKeyRef.current = '';
      applySelfSubject();
      return;
    }
    lastSelfWeatherKeyRef.current = '';
    applyCustomerSubject();
  };

  useEffect(() => {
    if (readOnly || lockCustomer || values.verificationSubject !== 'self') return;
    if (values.verificationType === 'RV') return;
    if (!rcProfile || !rcUid) return;
    if (values.customerId === rcUid && values.customerName.trim()) return;
    applySelfSubject();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync self subject when RC profile loads
  }, [readOnly, lockCustomer, values.verificationSubject, values.verificationType, rcProfile, rcUid]);

  const handleVerificationTypeChange = (verificationType: JobType) => {
    if (locked || verificationType === values.verificationType) return;
    if (verificationType === 'RV' && values.verificationSubject === 'self') {
      lastSelfWeatherKeyRef.current = '';
      onCustomerChange('', '', []);
      onChange({
        verificationType: 'RV',
        verificationSubject: 'customer',
        customerId: '',
        customerName: '',
        devices: [],
        ambientTemperature: '',
        relativeHumidity: '',
      });
      setEditingCustomer(false);
      setWeatherError('');
      return;
    }
    onChange({
      verificationType,
      devices: values.devices.map(device => ({ ...device, manufacturingYear: '' })),
    });
  };

  useEffect(() => {
    if (readOnly || lockCustomer || values.verificationType !== 'RV') return;
    if (values.verificationSubject !== 'self') return;
    applyCustomerSubject();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-verification is always customer-owned
  }, [readOnly, lockCustomer, values.verificationType, values.verificationSubject]);

  const handleCustomerSelect = (next: { customerId: string; customerName: string }) => {
    if (lockCustomer) return;
    setEditingCustomer(false);
    const customer = customers.find(c => c.id === next.customerId) ?? null;
    const existingNewDevices = values.devices.filter(d => d.isNewDevice);
    const registeredRows = withLaboratorySeal(deviceRowsFromCustomer(customer, products));
    const devices = withLaboratorySeal([...registeredRows, ...existingNewDevices]);
    onCustomerChange(next.customerId, next.customerName, devices);
    onChange({
      verificationSubject: 'customer',
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
                  onChange={() => handleVerificationTypeChange(opt.value)}
                  disabled={locked}
                  required
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="site-calibration-form-grid">
          <fieldset className="site-calibration-type-field mb-0 site-calibration-form-span-full">
            <legend className="form-group-label">Belongs to *</legend>
            <div className="site-calibration-type-options">
              {SUBJECT_OPTIONS.map(opt => (
                <label key={opt.value} className="site-calibration-type-option">
                  <input
                    type="radio"
                    name="verificationSubject"
                    value={opt.value}
                    checked={values.verificationSubject === opt.value}
                    onChange={() => handleSubjectChange(opt.value)}
                    disabled={locked || lockCustomer || (opt.value === 'self' && values.verificationType === 'RV')}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {isSelf ? (
            rcProfile ? (
              <RcDetailsSpecs rc={rcProfile} />
            ) : (
              <p className="text-muted text-sm site-calibration-form-span-full mb-0">
                Loading RC centre details…
              </p>
            )
          ) : (
            <>
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
            </>
          )}

          <div className="verification-env-section site-calibration-form-span-full">
            <p className="site-calibration-details-subheading mb-2">Site conditions</p>
            <div className="verification-env-grid">
              <fieldset className="verification-device-location-field mb-0">
                <legend className="form-group-label">Location *</legend>
                <div className="verification-device-location-options">
                  {VERIFICATION_LOCATION_OPTIONS.map((opt, index) => (
                    <label key={opt.value} className="verification-device-location-option site-calibration-type-option">
                      <input
                        type="radio"
                        name="verification-session-location"
                        value={opt.value}
                        checked={values.verificationLocation === opt.value}
                        onChange={() => onChange({ verificationLocation: opt.value as VerificationLocation })}
                        disabled={locked}
                        required={index === 0}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

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
                      ? 'Prefilling from weather…'
                      : isSelf
                        ? 'Required for submit. Auto-filled from RC postal code or GPS on My Profile when set.'
                        : 'Required for submit. Auto-filled when a customer is selected.'}
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
            </div>
          </div>

          {showDevices && (
            <div className="site-calibration-form-span-full">
              <VerificationDeviceFields
                devices={values.devices}
                deviceImages={deviceImages}
                deviceRvImages={deviceRvImages}
                verificationType={values.verificationType}
                onDeviceChange={onDeviceChange}
                onDeviceAdd={onDeviceAdd}
                onDeviceRemove={onDeviceRemove}
                onDeviceImageSelect={onDeviceImageSelect}
                onDeviceImageRemove={onDeviceImageRemove}
                onDeviceRvDocumentSelect={onDeviceRvDocumentSelect}
                onDeviceRvDocumentRemove={onDeviceRvDocumentRemove}
                verificationLocation={values.verificationLocation}
                feesStructure={resolveRcFeesStructure(rcProfile)}
                submitting={submitting}
                readOnly={readOnly}
                laboratorySealIdentification={laboratorySealIdentification}
                manualEntryOnly={isSelf}
                createMode={!lockCustomer && !readOnly && !isSelf}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
