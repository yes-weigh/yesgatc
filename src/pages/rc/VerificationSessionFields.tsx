import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, CloudSun, Droplets, Thermometer, X } from 'lucide-react';
import { SegmentToggle } from '../../components/SegmentToggle';
import { PartyInformationForm } from '../../components/PartyInformationForm';
import { VerificationFormStepper } from '../../components/VerificationFormStepper';
import { VerificationInstrumentMultistage } from './VerificationInstrumentMultistage';
import type { Customer, FirestoreUserDoc, JobType } from '../../types';
import type { AssignableVctOption } from '../../lib/verificationRequest';
import { customerFormFromRecord, isPendingNewCustomerParty } from '../../lib/customerProfileFields';
import {
  buildInitialSelfDeviceRows,
  deviceRowsFromCustomer,
  verificationLocationLabel,
  type DeviceVerificationImagesState,
  type DeviceRvDocumentsState,
  type VerificationDeviceRowValues,
  type VerificationSessionValues,
  type VerificationSubject,
  validateVerificationForSubmit,
} from '../../lib/siteCalibrationProfileFields';
import { rcProfileToFormValues } from '../../lib/rcProfileFormFields';
import { applyLaboratorySealToDeviceRows } from '../../lib/rcLaboratoryFields';
import {
  emptyDeviceImageSlot,
  emptyDeviceVerificationImagesState,
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import type { RvDocumentKind } from '../../lib/verificationRvDeviceImages';
import { defaultRvServiceFee, resolveRcFeesStructure } from '../../lib/rcProfileFields';
import { lookupWeatherByPincode } from '../../lib/pincodeWeatherLookup';
import { isValidPincode, normalizePincode } from '../../lib/contactFields';
import {
  persistVerificationPartyProfile,
  type PersistVerificationPartyResult,
} from '../../lib/verificationPartyPersist';
import { VerificationAiStatusPanel } from '../../components/VerificationAiStatusPanel';
import { VerificationDeclarationPanel } from '../../components/VerificationDeclarationPanel';
import { VerificationResultSummary } from '../../components/VerificationResultSummary';
import { VerificationFeesTotalSummary } from '../../components/VerificationFeesTotalSummary';
import { buildVerificationAiStatusItems } from '../../lib/verificationAiStatus';
import {
  buildDefaultVerificationTestSummary,
  DEFAULT_VERIFICATION_SUMMARY_INFO,
  DEFAULT_VERIFICATION_SUMMARY_REMARKS,
  formatVerificationSummaryDateTime,
} from '../../lib/verificationTestSummary';
import {
  isVerificationFormStepComplete,
  VERIFICATION_FORM_STEPS,
  verificationFormStepBlockReason,
  type VerificationFormStepContext,
  type VerificationFormStepId,
} from '../../lib/verificationFormSteps';
import { useAppContext } from '../../context/AppContext';
import type { CustomerFormValues } from '../../lib/customerProfileFields';
import { EMPTY_CUSTOMER_FORM } from './CustomerFormFields';
import { VerificationPerformerPhotoFields } from './VerificationPerformerPhotoFields';
import { requiresPerformerIdentityPhotos } from '../../lib/verificationPerformerPhotos';
import type { PerformerPhotoKind, PerformerPhotosState } from '../../lib/verificationPerformerPhotos';

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
  performerPhotos?: PerformerPhotosState;
  onPerformerPhotoSelect?: (kind: PerformerPhotoKind, file: File) => void;
  onPerformerPhotoRemove?: (kind: PerformerPhotoKind) => void;
  customers: Customer[];
  rcProfile: FirestoreUserDoc | null;
  rcUid?: string;
  /** Authenticated user — VCT uid or RC admin uid (not the RC centre id). */
  actorUid?: string;
  submitting: boolean;
  lockCustomer?: boolean;
  readOnly?: boolean;
  /** RC admin can assign draft verifications to a linked VCT. */
  allowPerformerAssignment?: boolean;
  assignableVcts?: AssignableVctOption[];
  laboratorySealIdentification?: string;
  onWizardStepChange?: (stepId: VerificationFormStepId, isLastStep: boolean) => void;
  onDeclarationAcceptedChange?: (accepted: boolean) => void;
  onPartyContextChange?: (context: VerificationFormStepContext) => void;
  onCancel?: () => void;
  wizardNavIncludesCancel?: boolean;
  mobileFloatingChrome?: boolean;
};

export type VerificationSessionFieldsHandle = {
  persistPartyChanges: () => Promise<PersistVerificationPartyResult>;
  /** Wizard step back when the hardware back button is pressed. */
  tryHistoryBack: () => boolean;
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
  performerPhotos,
  onPerformerPhotoSelect,
  onPerformerPhotoRemove,
  customers,
  rcProfile,
  rcUid,
  actorUid,
  submitting,
  lockCustomer = false,
  readOnly = false,
  allowPerformerAssignment = false,
  assignableVcts = [],
  laboratorySealIdentification = '',
  onWizardStepChange,
  onDeclarationAcceptedChange,
  onPartyContextChange,
  onCancel,
  wizardNavIncludesCancel = false,
  mobileFloatingChrome = false,
  },
  ref,
) {
  const { products } = useAppContext();
  const locked = submitting || readOnly;

  const [activeStep, setActiveStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [stepError, setStepError] = useState('');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [customerPartyForm, setCustomerPartyForm] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const [rcPartyForm, setRcPartyForm] = useState<CustomerFormValues>(EMPTY_CUSTOMER_FORM);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  const stepContext = useMemo<VerificationFormStepContext>(
    () => ({ customerForm: customerPartyForm, deviceImages, deviceRvImages, performerPhotos }),
    [customerPartyForm, deviceImages, deviceRvImages, performerPhotos],
  );

  useEffect(() => {
    onPartyContextChange?.(stepContext);
  }, [onPartyContextChange, stepContext]);
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

  const isOnInstrumentsStep = currentStep.id === 'instruments';
  const isOnReviewStep = currentStep.id === 'review';
  const isLastStep = isOnReviewStep;

  const stepDescription =
    isOnInstrumentsStep && includedDeviceEntries.length > 0
      ? 'Each instrument is a tile — complete photos, then swipe right within the tile to enter details.'
      : currentStep.description;

  const continueLabel =
    isOnInstrumentsStep && includedDeviceEntries.length > 0 ? 'Review' : 'Proceed';

  const canContinueCurrentStep = useMemo(() => {
    if (readOnly) return true;
    return (
      verificationFormStepBlockReason(currentStep.id, values, rcProfile, stepContext) === null
    );
  }, [readOnly, currentStep.id, values, rcProfile, stepContext]);

  const showWizardCancel =
    Boolean(wizardNavIncludesCancel && onCancel && currentStep.id !== 'review');
  const canAddInstrument = !readOnly && !lockCustomer && isOnInstrumentsStep;

  const showBackNav = activeStep > 0;
  const showWizardBottomBar = !readOnly && !isLastStep;

  const completedStepIds = useMemo(() => {
    const completed = new Set<VerificationFormStepId>();
    for (const step of VERIFICATION_FORM_STEPS) {
      if (isVerificationFormStepComplete(step.id, values, rcProfile, stepContext)) {
        completed.add(step.id);
      }
    }
    return completed;
  }, [values, rcProfile, stepContext]);

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

  useEffect(() => {
    if (!wizardNavIncludesCancel) return;
    if (currentStep.id === 'review') {
      setDeclarationAccepted(true);
      onDeclarationAcceptedChange?.(true);
      return;
    }
    setDeclarationAccepted(false);
    onDeclarationAcceptedChange?.(false);
  }, [currentStep.id, wizardNavIncludesCancel, onDeclarationAcceptedChange]);

  const handleDeclarationAcceptedChange = useCallback(
    (accepted: boolean) => {
      setDeclarationAccepted(accepted);
      onDeclarationAcceptedChange?.(accepted);
    },
    [onDeclarationAcceptedChange],
  );

  const handleStepSelect = (index: number) => {
    if (readOnly || index <= furthestStep) {
      setActiveStep(index);
      setStepError('');
    }
  };

  const handleContinue = () => {
    if (readOnly) return;
    setStepError('');

    if (isOnInstrumentsStep && showDevices) {
      const instrumentsReason = verificationFormStepBlockReason(
        'instruments',
        values,
        rcProfile,
        stepContext,
      );
      if (instrumentsReason) {
        setStepError(instrumentsReason);
        return;
      }

      const nextStep = activeStep + 1;
      setFurthestStep(prev => Math.max(prev, nextStep));
      setActiveStep(nextStep);
      return;
    }

    const reason = verificationFormStepBlockReason(currentStep.id, values, rcProfile, stepContext);
    if (reason) {
      setStepError(reason);
      return;
    }

    if (currentStep.id === 'setup' && values.devices.length === 0) {
      onDeviceAdd();
    }

    const nextStep = Math.min(activeStep + 1, VERIFICATION_FORM_STEPS.length - 1);
    setFurthestStep(prev => Math.max(prev, nextStep));
    setActiveStep(nextStep);

  };

  const handleAddInstrument = () => {
    if (!canAddInstrument) return;
    onDeviceAdd();
    setStepError('');
  };

  const handleBack = () => {
    setStepError('');
    setActiveStep(prev => Math.max(prev - 1, 0));
  };

  const handleReadOnlyNext = () => {
    setActiveStep(prev => Math.min(prev + 1, VERIFICATION_FORM_STEPS.length - 1));
  };

  const handleReadOnlyBack = () => {
    setActiveStep(prev => Math.max(prev - 1, 0));
  };

  const withLaboratorySeal = (devices: VerificationDeviceRowValues[]) => {
    if (readOnly || !laboratorySealIdentification.trim()) return devices;
    return applyLaboratorySealToDeviceRows(devices, laboratorySealIdentification.trim());
  };

  const isSelf = values.verificationSubject === 'self';
  const showDevices =
    isSelf || Boolean(values.customerId) || isPendingNewCustomerParty(customerPartyForm);

  const hasGpsLocation = useMemo(() => {
    const party = isSelf ? rcPartyForm : customerPartyForm;
    return Boolean(party.latitude.trim() && party.longitude.trim());
  }, [isSelf, rcPartyForm, customerPartyForm]);

  const mandatoryFieldsComplete = useMemo(
    () =>
      validateVerificationForSubmit(values, deviceImages, deviceRvImages, {
        customerForm: customerPartyForm,
      }) === null,
    [values, deviceImages, deviceRvImages, customerPartyForm],
  );

  const submitSummaryDateTime = useMemo(() => formatVerificationSummaryDateTime(), [isOnReviewStep]);
  const submitTestSummary = useMemo(() => buildDefaultVerificationTestSummary('PASS'), [isOnReviewStep]);

  const submitAiStatusItems = useMemo(() => {
    const firstIncluded = values.devices.find(row => row.included);
    if (!firstIncluded) return [];

    const images = deviceImages[firstIncluded.localId] ?? emptyDeviceVerificationImagesState();
    const rvDocuments = deviceRvImages[firstIncluded.localId];
    const product = products.find(entry => entry.id === firstIncluded.productId);
    const stamping = images.stamping ?? emptyDeviceImageSlot();
    const scale = images.scale ?? emptyDeviceImageSlot();
    const oldCertificate = rvDocuments?.oldCertificate ?? emptyDeviceImageSlot();

    return buildVerificationAiStatusItems({
      verificationType: values.verificationType,
      hasStampingImage:
        !stamping.removed && Boolean(stamping.file?.url || stamping.file?.path || stamping.pendingFile),
      hasInstrumentImage:
        !scale.removed && Boolean(scale.file?.url || scale.file?.path || scale.pendingFile),
      productModelApprovalNo: product?.modelApprovalNo ?? '',
      hasOldCertificate:
        !oldCertificate.removed &&
        Boolean(oldCertificate.file?.url || oldCertificate.file?.path || oldCertificate.pendingFile),
      hasGpsLocation,
      ambientTemperature: values.ambientTemperature,
      relativeHumidity: values.relativeHumidity,
      mandatoryFieldsComplete,
    });
  }, [
    values.devices,
    values.verificationType,
    values.ambientTemperature,
    values.relativeHumidity,
    deviceImages,
    deviceRvImages,
    products,
    hasGpsLocation,
    mandatoryFieldsComplete,
    isOnReviewStep,
  ]);

  const submitInstrumentLabel = useMemo(() => {
    const included = values.devices.filter(row => row.included);
    if (included.length === 0) return 'Weighing Scale';
    if (included.length === 1) {
      const device = included[0];
      const product = products.find(entry => entry.id === device.productId);
      if (product?.typeOfInstrument?.trim()) {
        return `${product.typeOfInstrument.trim()} Weighing Scale`;
      }
      if (device.productName.trim()) return device.productName.trim();
    }
    return `${included.length} instruments`;
  }, [values.devices, products]);

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
            rcId: rcUid,
            createdByUid: actorUid ?? rcUid,
          },
          customers,
        );
      },
      tryHistoryBack: () => {
        if (readOnly) return false;
        if (activeStep <= 0) return false;
        handleBack();
        return true;
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
      actorUid,
      customers,
      activeStep,
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
        onChange({ customerName: next.name });
        return next;
      });
    },
    [onChange],
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
      lastSelfWeatherKeyRef.current = '';
      applySelfSubject();
      return;
    }
    lastSelfWeatherKeyRef.current = '';
    applyCustomerSubject();
  };

  useEffect(() => {
    if (readOnly || lockCustomer || values.verificationSubject !== 'self') return;
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
      devices: values.devices.map(device => {
        const product = products.find(item => item.id === device.productId) ?? null;
        return {
          ...device,
          manufacturingYear: '',
          serviceFee: verificationType === 'RV' ? defaultRvServiceFee(product) : '',
          additionalFee: verificationType === 'RV' ? '0' : '',
        };
      }),
    });
  };

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
  const partyLocationCapture = !partyFormDisabled;

  const stepper = (
    <VerificationFormStepper
      steps={VERIFICATION_FORM_STEPS}
      activeStep={activeStep}
      furthestStep={furthestStep}
      completedStepIds={readOnly ? completedStepIds : undefined}
      onStepSelect={handleStepSelect}
      readOnly={readOnly}
    />
  );

  const wizardBottomBar =
    showWizardBottomBar ? (
      <div className="verification-wizard-bottom-bar">
        {stepError && (
          <p className="verification-wizard-bottom-bar-error rc-form-topbar-error mb-0" role="alert">
            {stepError}
          </p>
        )}
        <div className="verification-wizard-bottom-bar-actions">
          {showBackNav && (
            <button
              type="button"
              className="verification-form-btn verification-form-btn--back"
              onClick={handleBack}
              disabled={locked}
            >
              <ChevronLeft size={16} aria-hidden /> Back
            </button>
          )}
          {showWizardCancel && (
            <button
              type="button"
              className="verification-form-btn verification-form-btn--cancel"
              onClick={onCancel}
              disabled={locked}
            >
              <X size={16} aria-hidden /> Cancel
            </button>
          )}
          <button
            type="button"
            className="verification-form-btn verification-form-btn--continue"
            onClick={handleContinue}
            disabled={locked || !canContinueCurrentStep}
            aria-disabled={locked || !canContinueCurrentStep}
          >
            {continueLabel} <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div
      className={[
        'verification-wizard',
        'product-form-flat',
        'site-calibration-form-flat',
        mobileFloatingChrome ? 'verification-wizard--floating-chrome' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {mobileFloatingChrome
        ? createPortal(
            <div className="verification-mobile-chrome verification-mobile-chrome--stepper">
              {stepper}
            </div>,
            document.body,
          )
        : stepper}
      <div className="verification-wizard-stepper-spacer" aria-hidden />

      <div className="verification-wizard-content">
        <div className="verification-wizard-stage">
        <div className="verification-wizard-stage-head">
          <h3 className="verification-wizard-stage-title">{currentStep.label}</h3>
          <p className="verification-wizard-stage-desc text-muted text-sm mb-0">
            {stepDescription}
          </p>
        </div>

        <div
          key={currentStep.id}
          className="verification-wizard-panel fade-in"
        >
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
                      disabled: lockCustomer,
                    }))}
                    onChange={handleSubjectChange}
                    disabled={locked || lockCustomer}
                  />
                </div>
              </div>

              {allowPerformerAssignment && (
                <div className="verification-performer-field form-group">
                  <label htmlFor="verification-performer-select">Performed by</label>
                  <select
                    id="verification-performer-select"
                    className="input-field"
                    value={values.assignedVctId?.trim() || ''}
                    disabled={locked}
                    onChange={event => onChange({ assignedVctId: event.target.value })}
                  >
                    <option value="">Self (RC centre)</option>
                    {assignableVcts.map(vct => (
                      <option key={vct.uid} value={vct.uid}>
                        {vct.username}
                      </option>
                    ))}
                  </select>
                  <p className="text-muted text-sm mb-0 mt-2">
                    {assignableVcts.length === 0
                      ? 'Add and approve VCT technicians under VCT Management to assign verifications.'
                      : 'Assign this draft to a VCT technician, or leave as Self to keep it with the RC centre.'}
                  </p>
                </div>
              )}

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
                      districtLabel="District"
                      locationCapture={partyLocationCapture}
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
                    locationCapture={partyLocationCapture}
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

                <section className="verification-env-panel" aria-labelledby="verification-env-title">
                  <header className="verification-env-panel-head">
                    <div className="verification-env-weather-icon" aria-hidden>
                      <CloudSun strokeWidth={2} />
                    </div>
                    <div className="verification-env-panel-head-text">
                      <h3 id="verification-env-title" className="verification-env-panel-title">
                        Environmental conditions
                      </h3>
                      <p className="verification-env-panel-subtitle">
                        Record current environmental conditions at site
                      </p>
                    </div>
                    <span className="verification-env-badge">
                      <span className="verification-env-badge-dot" aria-hidden />
                      {verificationLocationLabel('in_situ')}
                    </span>
                  </header>
                  <div className="verification-env-panel-body">
                    <div className="verification-env-metrics">
                      <div className="verification-env-metric verification-env-metric--temp">
                        <div className="verification-env-metric-icon" aria-hidden>
                          <Thermometer strokeWidth={2} />
                        </div>
                        <div className="verification-env-metric-field">
                          <label htmlFor="verification-temp">Temperature (°C)</label>
                          <input
                            id="verification-temp"
                            type="text"
                            inputMode="decimal"
                            className="verification-env-metric-input"
                            placeholder={weatherLoading ? '…' : '28.5'}
                            value={values.ambientTemperature}
                            onChange={e => onChange({ ambientTemperature: e.target.value })}
                            disabled={locked || weatherLoading}
                          />
                        </div>
                        <span className="verification-env-metric-unit">°C</span>
                      </div>

                      <div className="verification-env-metric verification-env-metric--humidity">
                        <div className="verification-env-metric-icon" aria-hidden>
                          <Droplets strokeWidth={2} />
                        </div>
                        <div className="verification-env-metric-field">
                          <label htmlFor="verification-humidity">Humidity (%)</label>
                          <input
                            id="verification-humidity"
                            type="text"
                            inputMode="decimal"
                            className="verification-env-metric-input"
                            placeholder={weatherLoading ? '…' : '65'}
                            value={values.relativeHumidity}
                            onChange={e => onChange({ relativeHumidity: e.target.value })}
                            disabled={locked || weatherLoading}
                          />
                        </div>
                        <span className="verification-env-metric-unit">%</span>
                      </div>
                    </div>
                  </div>
                  {weatherError && (
                    <p className="verification-env-panel-error text-orange text-xs mb-0" role="alert">
                      {weatherError}
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}

          {currentStep.id === 'instruments' && (
            <VerificationInstrumentMultistage
              entries={includedDeviceEntries}
              devices={values.devices}
              deviceImages={deviceImages}
              deviceRvImages={deviceRvImages}
              verificationType={values.verificationType}
              verificationLocation={values.verificationLocation || 'in_situ'}
              verificationSubject={values.verificationSubject}
              onDeviceChange={onDeviceChange}
              onDeviceAdd={onDeviceAdd}
              onDeviceRemove={onDeviceRemove}
              onDeviceImageSelect={onDeviceImageSelect}
              onDeviceImageRemove={onDeviceImageRemove}
              onDeviceRvDocumentSelect={onDeviceRvDocumentSelect}
              onDeviceRvDocumentRemove={onDeviceRvDocumentRemove}
              rcProfile={rcProfile}
              submitting={submitting}
              readOnly={readOnly}
              lockCustomer={lockCustomer}
              isSelf={isSelf}
              laboratorySealIdentification={laboratorySealIdentification}
              canAddInstrument={canAddInstrument}
              onAddInstrument={handleAddInstrument}
              showDevices={showDevices}
            />
          )}

          {currentStep.id === 'review' && showDevices && (
            <>
              <VerificationAiStatusPanel items={submitAiStatusItems} />
              <VerificationResultSummary
                instrumentLabel={submitInstrumentLabel}
                tests={submitTestSummary}
                overallResult="PASS"
                dateTime={submitSummaryDateTime}
                remarks={DEFAULT_VERIFICATION_SUMMARY_REMARKS}
                infoMessage={DEFAULT_VERIFICATION_SUMMARY_INFO}
              />
              <VerificationFeesTotalSummary
                devices={values.devices}
                verificationType={values.verificationType}
                verificationLocation={values.verificationLocation || 'in_situ'}
                verificationSubject={values.verificationSubject}
                feesStructure={resolveRcFeesStructure(rcProfile)}
                compact
              />
              {!readOnly && (
                <VerificationDeclarationPanel
                  checked={declarationAccepted}
                  onChange={accepted => handleDeclarationAcceptedChange(accepted)}
                  disabled={locked}
                />
              )}
              {requiresPerformerIdentityPhotos(values.verificationType)
                && performerPhotos
                && onPerformerPhotoSelect
                && onPerformerPhotoRemove && (
                <VerificationPerformerPhotoFields
                  photos={performerPhotos}
                  disabled={locked}
                  onSelect={onPerformerPhotoSelect}
                  onRemove={onPerformerPhotoRemove}
                />
              )}
            </>
          )}

        </div>
      </div>
      </div>

      {mobileFloatingChrome && wizardBottomBar
        ? createPortal(
            <div className="verification-mobile-chrome verification-mobile-chrome--actions">
              {wizardBottomBar}
            </div>,
            document.body,
          )
        : wizardBottomBar}

      {readOnly && !isLastStep && (
        <div className="verification-wizard-bottom-bar verification-wizard-bottom-bar--readonly">
          <div className="verification-wizard-bottom-bar-actions">
            {showBackNav && (
              <button
                type="button"
                className="verification-form-btn verification-form-btn--back"
                onClick={handleReadOnlyBack}
              >
                <ChevronLeft size={16} aria-hidden /> Previous
              </button>
            )}
            <button
              type="button"
              className="verification-form-btn verification-form-btn--continue"
              onClick={handleReadOnlyNext}
            >
              {continueLabel} <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
