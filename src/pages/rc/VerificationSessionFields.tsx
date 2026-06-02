import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SegmentToggle } from '../../components/SegmentToggle';
import { PartyInformationForm } from '../../components/PartyInformationForm';
import { VerificationFormStepper } from '../../components/VerificationFormStepper';
import type { Customer, FirestoreUserDoc, JobType } from '../../types';
import { customerFormFromRecord } from '../../lib/customerProfileFields';
import {
  buildInitialSelfDeviceRows,
  deviceRowsFromCustomer,
  verificationLocationLabel,
  type DeviceVerificationImagesState,
  type DeviceRvDocumentsState,
  type VerificationDeviceRowValues,
  type VerificationSessionValues,
  type VerificationSubject,
} from '../../lib/siteCalibrationProfileFields';
import { rcProfileToFormValues } from '../../lib/rcProfileFormFields';
import { applyLaboratorySealToDeviceRows } from '../../lib/rcLaboratoryFields';
import {
  emptyDeviceVerificationImagesState,
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import type { RvDocumentKind } from '../../lib/verificationRvDeviceImages';
import { resolveRcFeesStructure } from '../../lib/rcProfileFields';
import { lookupWeatherByPincode } from '../../lib/pincodeWeatherLookup';
import { isValidPincode, normalizePincode } from '../../lib/contactFields';
import {
  persistVerificationPartyProfile,
  type PersistVerificationPartyResult,
} from '../../lib/verificationPartyPersist';
import {
  isVerificationFormStepComplete,
  VERIFICATION_FORM_STEPS,
  verificationFormStepBlockReason,
  type VerificationFormStepId,
} from '../../lib/verificationFormSteps';
import { useAppContext } from '../../context/AppContext';
import { VerificationDeviceFields } from './VerificationDeviceFields';
import { VerificationDeviceEvidenceFields } from './VerificationDeviceEvidenceFields';
import { EMPTY_CUSTOMER_FORM, type CustomerFormValues } from './CustomerFormFields';

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
  onWizardStepChange?: (stepId: VerificationFormStepId, isLastStep: boolean) => void;
};

export type VerificationSessionFieldsHandle = {
  persistPartyChanges: () => Promise<PersistVerificationPartyResult>;
};

const VERIFICATION_TYPE_OPTIONS: { value: JobType; label: string }[] = [
  { value: 'OV', label: 'OV' },
  { value: 'RV', label: 'RV' },
];

const SUBJECT_OPTIONS: { value: VerificationSubject; label: string }[] = [
  { value: 'self', label: 'Self' },
  { value: 'customer', label: 'Customer' },
];

export const VerificationSessionFields = forwardRef<
  VerificationSessionFieldsHandle,
  VerificationSessionFieldsProps
>(function VerificationSessionFields(
  {
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
  onWizardStepChange,
  },
  ref,
) {
  const { products } = useAppContext();
  const locked = submitting || readOnly;

  const [activeStep, setActiveStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [evidenceDeviceIndex, setEvidenceDeviceIndex] = useState(0);
  const [pendingEvidenceDeviceIndex, setPendingEvidenceDeviceIndex] = useState<number | null>(null);
  const [stepError, setStepError] = useState('');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [customerPartyForm, setCustomerPartyForm] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const [rcPartyForm, setRcPartyForm] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const lastSelfWeatherKeyRef = useRef('');
  const lastRcPartySeedRef = useRef('');

  const currentStep = VERIFICATION_FORM_STEPS[activeStep];

  const includedDeviceEntries = useMemo(
    () =>
      values.devices
        .map((row, sessionIndex) => ({ row, sessionIndex }))
        .filter(entry => entry.row.included),
    [values.devices],
  );

  const isOnEvidenceStep = currentStep.id === 'evidence';
  const isLastEvidenceDevice =
    includedDeviceEntries.length === 0 ||
    evidenceDeviceIndex >= includedDeviceEntries.length - 1;
  const isLastStep = isOnEvidenceStep && isLastEvidenceDevice;

  const stepDescription =
    isOnEvidenceStep && includedDeviceEntries.length > 0
      ? includedDeviceEntries.length > 1
        ? `Attach photos and documents for device ${evidenceDeviceIndex + 1} of ${includedDeviceEntries.length}. Use Next device to continue.`
        : 'Attach verification photos and documents for the selected device.'
      : currentStep.description;

  const continueLabel =
    isOnEvidenceStep && !isLastEvidenceDevice && includedDeviceEntries.length > 1
      ? 'Next device'
      : 'Continue';

  const devicesStepIndex = VERIFICATION_FORM_STEPS.findIndex(step => step.id === 'devices');
  const canAddDeviceFromEvidence =
    !readOnly && !lockCustomer && isOnEvidenceStep && isLastEvidenceDevice;

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
    if (!isOnEvidenceStep) {
      setEvidenceDeviceIndex(0);
      return;
    }
    setEvidenceDeviceIndex(prev =>
      Math.min(prev, Math.max(0, includedDeviceEntries.length - 1)),
    );
  }, [isOnEvidenceStep, includedDeviceEntries.length]);

  useEffect(() => {
    onWizardStepChange?.(currentStep.id, isLastStep);
  }, [currentStep.id, isLastStep, onWizardStepChange]);

  useEffect(() => {
    setStepError('');
  }, [activeStep]);

  const handleStepSelect = (index: number) => {
    if (readOnly || index <= furthestStep) {
      if (VERIFICATION_FORM_STEPS[index]?.id === 'evidence') {
        setEvidenceDeviceIndex(0);
      }
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

    if (isOnEvidenceStep && !isLastEvidenceDevice) {
      setEvidenceDeviceIndex(prev => prev + 1);
      return;
    }

    if (currentStep.id === 'setup' && values.devices.length === 0) {
      onDeviceAdd();
    }

    const nextStep = Math.min(activeStep + 1, VERIFICATION_FORM_STEPS.length - 1);
    setFurthestStep(prev => Math.max(prev, nextStep));
    setActiveStep(nextStep);

    if (currentStep.id === 'devices') {
      setEvidenceDeviceIndex(pendingEvidenceDeviceIndex ?? 0);
      setPendingEvidenceDeviceIndex(null);
    } else if (currentStep.id === 'setup') {
      setEvidenceDeviceIndex(0);
      setPendingEvidenceDeviceIndex(null);
    }
  };

  const handleAddDeviceFromEvidence = () => {
    if (!canAddDeviceFromEvidence) return;
    const nextDeviceIndex = includedDeviceEntries.length;
    onDeviceAdd();
    setPendingEvidenceDeviceIndex(nextDeviceIndex);
    setStepError('');
    setActiveStep(devicesStepIndex);
    setFurthestStep(prev => Math.max(prev, devicesStepIndex));
  };

  const handleBack = () => {
    setStepError('');
    if (isOnEvidenceStep && evidenceDeviceIndex > 0) {
      setEvidenceDeviceIndex(prev => prev - 1);
      return;
    }
    setActiveStep(prev => Math.max(prev - 1, 0));
  };

  const handleReadOnlyNext = () => {
    if (isOnEvidenceStep && !isLastEvidenceDevice) {
      setEvidenceDeviceIndex(prev => prev + 1);
      return;
    }
    setActiveStep(prev => Math.min(prev + 1, VERIFICATION_FORM_STEPS.length - 1));
  };

  const handleReadOnlyBack = () => {
    if (isOnEvidenceStep && evidenceDeviceIndex > 0) {
      setEvidenceDeviceIndex(prev => prev - 1);
      return;
    }
    setActiveStep(prev => Math.max(prev - 1, 0));
  };

  const withLaboratorySeal = (devices: VerificationDeviceRowValues[]) => {
    if (readOnly || !laboratorySealIdentification.trim()) return devices;
    return applyLaboratorySealToDeviceRows(devices, laboratorySealIdentification.trim());
  };

  const isSelf = values.verificationSubject === 'self';
  const showDevices = isSelf || Boolean(values.customerId);

  useImperativeHandle(
    ref,
    () => ({
      persistPartyChanges: async () => {
        if (readOnly || lockCustomer) return { error: null };
        return persistVerificationPartyProfile(
          {
            isSelf,
            customerId: values.customerId,
            customerForm: customerPartyForm,
            rcForm: rcPartyForm,
            rcUid,
          },
          customers,
        );
      },
    }),
    [
      readOnly,
      lockCustomer,
      isSelf,
      values.customerId,
      customerPartyForm,
      rcPartyForm,
      rcUid,
      customers,
    ],
  );

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

  useEffect(() => {
    if (isSelf) return;
    if (!values.customerId) {
      setCustomerPartyForm(EMPTY_CUSTOMER_FORM);
      return;
    }
    const customer = customers.find(c => c.id === values.customerId);
    if (customer) {
      setCustomerPartyForm(customerFormFromRecord(customer));
    }
  }, [isSelf, values.customerId]);

  useEffect(() => {
    if (!isSelf) {
      lastRcPartySeedRef.current = '';
      return;
    }
    if (!rcProfile || !rcUid) return;
    const seedKey = `${rcUid}:${rcProfile.companyName ?? ''}:${rcProfile.pincode ?? ''}`;
    if (lastRcPartySeedRef.current === seedKey) return;
    lastRcPartySeedRef.current = seedKey;
    setRcPartyForm(rcProfileToFormValues(rcProfile));
  }, [isSelf, rcUid, rcProfile]);

  const handleCustomerPartyChange = useCallback(
    (patch: Partial<CustomerFormValues>) => {
      setCustomerPartyForm(prev => {
        const next = { ...prev, ...patch };
        if (values.customerId) {
          onChange({ customerName: next.name });
        }
        return next;
      });
    },
    [onChange, values.customerId],
  );

  const handleRcPartyChange = useCallback((patch: Partial<CustomerFormValues>) => {
    setRcPartyForm(prev => {
      const next = { ...prev, ...patch };
      onChange({ customerName: next.name });
      return next;
    });
  }, [onChange]);

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

  const handleSelectCustomerFromLookup = (customer: Customer) => {
    setCustomerPartyForm(customerFormFromRecord(customer));
    handleCustomerSelect({ customerId: customer.id, customerName: customer.name });
  };

  const partyFormDisabled = locked || lockCustomer;

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
            {stepDescription}
          </p>
        </div>

        <div key={currentStep.id} className="verification-wizard-panel fade-in">
          {currentStep.id === 'setup' && (
            <div className="verification-setup-step">
              <div className="verification-setup-toggles">
                <div className="verification-setup-toggle-field">
                  <span className="verification-setup-toggle-label">Type</span>
                  <SegmentToggle
                    ariaLabel="Verification type"
                    value={values.verificationType === 'RV' ? 'RV' : 'OV'}
                    options={VERIFICATION_TYPE_OPTIONS.map(opt => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    onChange={handleVerificationTypeChange}
                    disabled={locked}
                  />
                </div>
                <div className="verification-setup-toggle-field">
                  <span className="verification-setup-toggle-label">Party</span>
                  <SegmentToggle
                    ariaLabel="Verification party"
                    value={values.verificationSubject === 'customer' ? 'customer' : 'self'}
                    options={SUBJECT_OPTIONS.map(opt => ({
                      value: opt.value,
                      label: opt.label,
                      disabled:
                        lockCustomer ||
                        (opt.value === 'self' && values.verificationType === 'RV'),
                    }))}
                    onChange={handleSubjectChange}
                    disabled={locked || lockCustomer}
                  />
                </div>
              </div>

              <div className="verification-party-site-step">
                {isSelf ? (
                  rcProfile ? (
                    <PartyInformationForm
                      title="SELF INFORMATION"
                      values={rcPartyForm}
                      onChange={handleRcPartyChange}
                      disabled={partyFormDisabled}
                      compact
                      nameLabel="Centre Name"
                      districtLabel="Place"
                    />
                  ) : (
                    <p className="text-muted text-sm site-calibration-form-span-full mb-0">
                      Loading RC centre details…
                    </p>
                  )
                ) : (
                  <PartyInformationForm
                    title="CUSTOMER INFORMATION"
                    values={customerPartyForm}
                    onChange={handleCustomerPartyChange}
                    disabled={partyFormDisabled}
                    compact
                    lookup={
                      partyFormDisabled
                        ? undefined
                        : {
                            customers,
                            selectedCustomerId: values.customerId,
                            onSelectCustomer: handleSelectCustomerFromLookup,
                          }
                    }
                  />
                )}

                <div className="verification-site-conditions">
                  <div className="verification-site-conditions-head">
                    <span className="verification-site-conditions-title">Site conditions</span>
                    <span className="verification-site-location-badge">
                      {verificationLocationLabel('in_situ')}
                    </span>
                  </div>
                  <div className="verification-site-conditions-metrics">
                    <div className="form-group mb-0 verification-site-metric">
                      <label htmlFor="verification-temp">Temp (°C)</label>
                      <input
                        id="verification-temp"
                        type="text"
                        inputMode="decimal"
                        className="input-field verification-site-metric-input"
                        placeholder={weatherLoading ? '…' : '28.5'}
                        value={values.ambientTemperature}
                        onChange={e => onChange({ ambientTemperature: e.target.value })}
                        disabled={locked || weatherLoading}
                      />
                    </div>

                    <div className="form-group mb-0 verification-site-metric">
                      <label htmlFor="verification-humidity">Humidity (%)</label>
                      <input
                        id="verification-humidity"
                        type="text"
                        inputMode="decimal"
                        className="input-field verification-site-metric-input"
                        placeholder={weatherLoading ? '…' : '65'}
                        value={values.relativeHumidity}
                        onChange={e => onChange({ relativeHumidity: e.target.value })}
                        disabled={locked || weatherLoading}
                      />
                    </div>
                  </div>
                  {weatherError && (
                    <p className="verification-site-conditions-error text-orange text-xs mb-0" role="alert">
                      {weatherError}
                    </p>
                  )}
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
              compact
              includeEvidence={false}
              allowAddDevice={false}
            />
          )}

          {currentStep.id === 'evidence' && showDevices && includedDeviceEntries.length > 0 && (
            <VerificationDeviceEvidenceFields
              device={includedDeviceEntries[evidenceDeviceIndex].row}
              deviceIndex={evidenceDeviceIndex}
              totalDevices={includedDeviceEntries.length}
              verificationType={values.verificationType}
              images={
                deviceImages[includedDeviceEntries[evidenceDeviceIndex].row.localId] ??
                emptyDeviceVerificationImagesState()
              }
              rvDocuments={
                deviceRvImages[includedDeviceEntries[evidenceDeviceIndex].row.localId]
              }
              onImageSelect={(kind, file) =>
                onDeviceImageSelect(
                  includedDeviceEntries[evidenceDeviceIndex].row.localId,
                  kind,
                  file,
                )
              }
              onImageRemove={kind =>
                onDeviceImageRemove(
                  includedDeviceEntries[evidenceDeviceIndex].row.localId,
                  kind,
                )
              }
              onRvDocumentSelect={
                onDeviceRvDocumentSelect
                  ? (kind, file) =>
                      onDeviceRvDocumentSelect(
                        includedDeviceEntries[evidenceDeviceIndex].row.localId,
                        kind,
                        file,
                      )
                  : undefined
              }
              onRvDocumentRemove={
                onDeviceRvDocumentRemove
                  ? kind =>
                      onDeviceRvDocumentRemove(
                        includedDeviceEntries[evidenceDeviceIndex].row.localId,
                        kind,
                      )
                  : undefined
              }
              submitting={submitting}
              readOnly={readOnly}
              showAddDevice={canAddDeviceFromEvidence}
              onAddDevice={handleAddDeviceFromEvidence}
            />
          )}

          {currentStep.id === 'evidence' && showDevices && includedDeviceEntries.length === 0 && (
            <p className="text-muted text-sm mb-0">
              Select at least one device on the previous step.
            </p>
          )}

          {currentStep.id === 'devices' && !showDevices && (
            <p className="text-muted text-sm mb-0">
              Select a customer above to load devices.
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
              {(activeStep > 0 || (isOnEvidenceStep && evidenceDeviceIndex > 0)) && (
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
                  {continueLabel} <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="verification-wizard-nav">
            <div className="verification-wizard-nav-actions">
              {(activeStep > 0 || (isOnEvidenceStep && evidenceDeviceIndex > 0)) && (
                <button
                  type="button"
                  className="btn btn-secondary flex items-center gap-1.5"
                  onClick={handleReadOnlyBack}
                >
                  <ChevronLeft size={16} /> Previous
                </button>
              )}
              {!isLastStep && (
                <button
                  type="button"
                  className="btn btn-secondary flex items-center gap-1.5"
                  onClick={handleReadOnlyNext}
                >
                  {continueLabel} <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
