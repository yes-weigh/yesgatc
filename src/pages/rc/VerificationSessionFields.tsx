import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CustomerSelect } from '../../components/CustomerSelect';
import { CustomerDetailsSpecs } from '../../components/CustomerDetailsSpecs';
import { RcDetailsSpecs } from '../../components/RcDetailsSpecs';
import { VerificationFormStepper } from '../../components/VerificationFormStepper';
import type { Customer, FirestoreUserDoc, JobType } from '../../types';
import {
  buildInitialSelfDeviceRows,
  deviceRowsFromCustomer,
  syncVerificationDevicesAfterCustomerUpdate,
  verificationLocationLabel,
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
import {
  isVerificationFormStepComplete,
  VERIFICATION_FORM_STEPS,
  verificationFormStepBlockReason,
  type VerificationFormStepId,
} from '../../lib/verificationFormSteps';
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
  onWizardStepChange?: (stepId: VerificationFormStepId, isLastStep: boolean) => void;
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
  onWizardStepChange,
}) => {
  const { products } = useAppContext();
  const locked = submitting || readOnly;

  const [activeStep, setActiveStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [stepError, setStepError] = useState('');

  const currentStep = VERIFICATION_FORM_STEPS[activeStep];
  const isLastStep = activeStep === VERIFICATION_FORM_STEPS.length - 1;

  const completedStepIds = useMemo(() => {
    const completed = new Set<VerificationFormStepId>();
    for (const step of VERIFICATION_FORM_STEPS) {
      if (isVerificationFormStepComplete(step.id, values, rcProfile)) {
        completed.add(step.id);
      }
    }
    return completed;
  }, [values, rcProfile]);

  useEffect(() => {
    if (values.verificationLocation !== 'in_situ') {
      onChange({ verificationLocation: 'in_situ' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lock location to in situ for all verifications
  }, []);

  useEffect(() => {
    if (readOnly) {
      setFurthestStep(VERIFICATION_FORM_STEPS.length - 1);
    }
  }, [readOnly]);

  useEffect(() => {
    onWizardStepChange?.(currentStep.id, isLastStep);
  }, [currentStep.id, isLastStep, onWizardStepChange]);

  useEffect(() => {
    setStepError('');
  }, [activeStep]);

  const handleStepSelect = (index: number) => {
    if (readOnly || index <= furthestStep) {
      setActiveStep(index);
      setStepError('');
    }
  };

  const handleContinue = () => {
    if (readOnly) return;
    const reason = verificationFormStepBlockReason(currentStep.id, values, rcProfile);
    if (reason) {
      setStepError(reason);
      return;
    }
    setStepError('');
    const nextStep = Math.min(activeStep + 1, VERIFICATION_FORM_STEPS.length - 1);
    setFurthestStep(prev => Math.max(prev, nextStep));
    setActiveStep(nextStep);
  };

  const handleBack = () => {
    setStepError('');
    setActiveStep(prev => Math.max(prev - 1, 0));
  };

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
    <div className="verification-wizard product-form-flat site-calibration-form-flat">
      <VerificationFormStepper
        steps={VERIFICATION_FORM_STEPS}
        activeStep={activeStep}
        furthestStep={furthestStep}
        completedStepIds={readOnly ? completedStepIds : undefined}
        onStepSelect={handleStepSelect}
        readOnly={readOnly}
      />

      <div className="verification-wizard-stage glass">
        <div className="verification-wizard-stage-head">
          <h3 className="verification-wizard-stage-title">{currentStep.label}</h3>
          <p className="verification-wizard-stage-desc text-muted text-sm mb-0">
            {currentStep.description}
          </p>
        </div>

        <div key={currentStep.id} className="verification-wizard-panel fade-in">
          {currentStep.id === 'type' && (
            <div className="site-calibration-form-row">
              <fieldset className="site-calibration-type-field mb-0">
                <legend className="form-group-label">Verification type *</legend>
                <div className="site-calibration-type-options verification-wizard-type-options">
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
                      <span className="verification-option-label">
                        <span className="verification-option-label-full">{opt.label}</span>
                        <span className="verification-option-label-short">{opt.value}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

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
            </div>
          )}

          {currentStep.id === 'party_site' && (
            <div className="verification-party-site-step">
              <div className="site-calibration-form-grid">
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
              </div>

              <div className="verification-env-section verification-env-section--combined">
                <div className="verification-site-location-display">
                  <span className="form-group-label">Location</span>
                  <span className="verification-site-location-badge">
                    {verificationLocationLabel('in_situ')}
                  </span>
                </div>
                <div className="verification-env-grid verification-env-grid--metrics">
                  <div className="form-group mb-0">
                    <label htmlFor="verification-temp">Temperature (°C)</label>
                    <input
                      id="verification-temp"
                      type="text"
                      inputMode="decimal"
                      className="input-field"
                      placeholder={weatherLoading ? 'Fetching…' : '28.5'}
                      value={values.ambientTemperature}
                      onChange={e => onChange({ ambientTemperature: e.target.value })}
                      disabled={locked || weatherLoading}
                    />
                    {weatherError && (
                      <p className="text-orange text-xs mt-1 mb-0" role="alert">{weatherError}</p>
                    )}
                  </div>

                  <div className="form-group mb-0">
                    <label htmlFor="verification-humidity">Humidity (%)</label>
                    <input
                      id="verification-humidity"
                      type="text"
                      inputMode="decimal"
                      className="input-field"
                      placeholder={weatherLoading ? 'Fetching…' : '65'}
                      value={values.relativeHumidity}
                      onChange={e => onChange({ relativeHumidity: e.target.value })}
                      disabled={locked || weatherLoading}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep.id === 'devices' && showDevices && (
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
              verificationLocation={values.verificationLocation || 'in_situ'}
              verificationSubject={values.verificationSubject}
              feesStructure={resolveRcFeesStructure(rcProfile)}
              submitting={submitting}
              readOnly={readOnly}
              laboratorySealIdentification={laboratorySealIdentification}
              manualEntryOnly={isSelf}
              createMode={!lockCustomer && !readOnly && !isSelf}
            />
          )}

          {currentStep.id === 'devices' && !showDevices && (
            <p className="text-muted text-sm mb-0">
              Select a customer on the Details step first to load devices.
            </p>
          )}
        </div>

        {!readOnly ? (
          <div className="verification-wizard-nav">
            {stepError && (
              <p className="verification-wizard-nav-error rc-form-topbar-error mb-0" role="alert">
                {stepError}
              </p>
            )}
            <div className="verification-wizard-nav-actions">
              {activeStep > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary flex items-center gap-1.5"
                  onClick={handleBack}
                  disabled={locked}
                >
                  <ChevronLeft size={16} /> Back
                </button>
              )}
              {!isLastStep && (
                <button
                  type="button"
                  className="btn btn-primary flex items-center gap-1.5"
                  onClick={handleContinue}
                  disabled={locked}
                >
                  Continue <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="verification-wizard-nav">
            <div className="verification-wizard-nav-actions">
              {activeStep > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary flex items-center gap-1.5"
                  onClick={handleBack}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
              )}
              {!isLastStep && (
                <button
                  type="button"
                  className="btn btn-secondary flex items-center gap-1.5"
                  onClick={() => setActiveStep(prev => Math.min(prev + 1, VERIFICATION_FORM_STEPS.length - 1))}
                >
                  Next <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
