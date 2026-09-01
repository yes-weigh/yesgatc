import type { FirestoreUserDoc, Product } from '../types';
import { isPendingNewCustomerParty, type CustomerFormValues } from './customerProfileFields';
import { isValidPincode, normalizePincode } from './contactFields';
import { VERIFICATION_PINCODE_REQUIRED_MESSAGE } from './verificationSubmitGates';
import {
  validateVerificationDeviceDetails,
  type VerificationSessionValues,
} from './siteCalibrationProfileFields';
import {
  emptyDeviceVerificationImagesState,
  validateDeviceVerificationImages,
  type DeviceVerificationImagesState,
} from './verificationDeviceImages';
import {
  emptyDeviceRvDocumentsState,
  validateDeviceRvDocuments,
  type DeviceRvDocumentsState,
} from './verificationRvDeviceImages';
import {
  emptyPerformerPhotosState,
  requiresPerformerIdentityPhotos,
  validatePerformerPhotos,
  type PerformerPhotosState,
} from './verificationPerformerPhotos';
import { validateOvQuotaDevices, validateOvQuotaSetup, type OvQuotaGate } from './ovQuotaGate';

export type VerificationFormStepId = 'setup' | 'instruments' | 'review' | 'product' | 'site' | 'photos';

export type VerificationInstrumentSubStage = 'photos' | 'details';

export type VerificationFormStepDef = {
  id: VerificationFormStepId;
  label: string;
  shortLabel: string;
  description: string;
};

export const VERIFICATION_FORM_STEPS: VerificationFormStepDef[] = [
  {
    id: 'setup',
    label: 'Belongs to',
    shortLabel: 'Belongs to',
    description: 'Choose who this verification belongs to and confirm site conditions.',
  },
  {
    id: 'instruments',
    label: 'Instruments',
    shortLabel: 'Instruments',
    description: 'Each instrument is a tile — complete photos, swipe right for details, then scroll between tiles to update anytime.',
  },
  {
    id: 'review',
    label: 'Review',
    shortLabel: 'Review',
    description: 'Confirm the verification summary, fees, and declaration before submitting.',
  },
];

/** New OV Self job — serial already picked. Customer is the RC centre. Site skipped (In situ + Self). */
export const OV_SELF_FORM_STEPS: VerificationFormStepDef[] = [
  {
    id: 'product',
    label: 'Product',
    shortLabel: 'Product',
    description: 'Choose the instrument. MPE and seal ID fill automatically.',
  },
  {
    id: 'photos',
    label: 'Photos',
    shortLabel: 'Photos',
    description: 'Upload required verification photos.',
  },
  {
    id: 'review',
    label: 'Submit',
    shortLabel: 'Submit',
    description: 'Confirm conditions and submit for certification.',
  },
];

/** New OV Customer — serial picked, then customer → product → photos → submit. */
export const OV_CUSTOMER_FORM_STEPS: VerificationFormStepDef[] = [
  {
    id: 'setup',
    label: 'Customer',
    shortLabel: 'Customer',
    description: 'Select the customer this verification belongs to.',
  },
  {
    id: 'product',
    label: 'Product',
    shortLabel: 'Product',
    description: 'Choose the instrument. MPE and seal ID fill automatically.',
  },
  {
    id: 'photos',
    label: 'Photos',
    shortLabel: 'Photos',
    description: 'Upload required verification photos.',
  },
  {
    id: 'review',
    label: 'Submit',
    shortLabel: 'Submit',
    description: 'Confirm conditions and submit for certification.',
  },
];

/** New RV Customer — serial entered manually, then same compact path as OV Customer (+ RV docs). */
export const RV_CUSTOMER_FORM_STEPS: VerificationFormStepDef[] = OV_CUSTOMER_FORM_STEPS;

export function isOvSelfWizard(
  lockKind: boolean,
  values: { verificationType: string; verificationSubject: string },
): boolean {
  return lockKind && values.verificationType === 'OV' && values.verificationSubject === 'self';
}

export function isOvCustomerWizard(
  lockKind: boolean,
  values: { verificationType: string; verificationSubject: string },
): boolean {
  return lockKind && values.verificationType === 'OV' && values.verificationSubject === 'customer';
}

export function isRvCustomerWizard(
  lockKind: boolean,
  values: { verificationType: string; verificationSubject: string },
): boolean {
  return lockKind && values.verificationType === 'RV' && values.verificationSubject === 'customer';
}

/** Compact mobile flow (product shop → photos → submit) for OV Self / OV Customer / RV Customer. */
export function isOvCompactWizard(
  lockKind: boolean,
  values: { verificationType: string; verificationSubject: string },
): boolean {
  return (
    isOvSelfWizard(lockKind, values)
    || isOvCustomerWizard(lockKind, values)
    || isRvCustomerWizard(lockKind, values)
  );
}

export function verificationWizardSteps(options: {
  lockKind: boolean;
  verificationType: string;
  verificationSubject: string;
}): VerificationFormStepDef[] {
  if (isOvSelfWizard(options.lockKind, options)) return OV_SELF_FORM_STEPS;
  if (isOvCustomerWizard(options.lockKind, options)) return OV_CUSTOMER_FORM_STEPS;
  if (isRvCustomerWizard(options.lockKind, options)) return RV_CUSTOMER_FORM_STEPS;
  return VERIFICATION_FORM_STEPS;
}

export type VerificationFormStepContext = {
  customerForm?: CustomerFormValues;
  rcForm?: CustomerFormValues;
  deviceImages?: Record<string, DeviceVerificationImagesState>;
  deviceRvImages?: Record<string, DeviceRvDocumentsState>;
  performerPhotos?: PerformerPhotosState;
  ovQuota?: OvQuotaGate | null;
  isNewJob?: boolean;
  products?: Product[];
};

function partyStepBlockReason(
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
  context?: VerificationFormStepContext,
): string | null {
  if (values.verificationSubject === 'self') {
    const name =
      values.customerName.trim() ||
      rcProfile?.companyName?.trim() ||
      rcProfile?.username?.trim() ||
      '';
    if (!name) return 'RC centre details are still loading. Please wait a moment.';
    const pin = context?.rcForm?.pincode ?? rcProfile?.pincode ?? '';
    if (!isValidPincode(normalizePincode(pin))) {
      return VERIFICATION_PINCODE_REQUIRED_MESSAGE;
    }
    return null;
  }
  if (values.customerId.trim()) {
    const pin = context?.customerForm?.pincode ?? '';
    if (context?.customerForm && !isValidPincode(normalizePincode(pin))) {
      return VERIFICATION_PINCODE_REQUIRED_MESSAGE;
    }
    return null;
  }
  if (context?.customerForm && isPendingNewCustomerParty(context.customerForm)) {
    if (!isValidPincode(normalizePincode(context.customerForm.pincode))) {
      return VERIFICATION_PINCODE_REQUIRED_MESSAGE;
    }
    return null;
  }
  return 'Select a customer from lookup or enter name and mobile number.';
}

function siteStepBlockReason(values: VerificationSessionValues): string | null {
  if (values.verificationLocation !== 'in_situ' && values.verificationLocation !== 'in_premises') {
    return 'Select In situ or In the premises.';
  }
  if (!values.ambientTemperature.trim()) return 'Temperature is required.';
  if (!values.relativeHumidity.trim()) return 'Humidity is required.';

  const temp = Number(values.ambientTemperature.trim());
  if (Number.isNaN(temp)) return 'Temperature must be a number.';

  const humidity = Number(values.relativeHumidity.trim());
  if (Number.isNaN(humidity) || humidity < 0 || humidity > 100) {
    return 'Humidity must be a number between 0 and 100.';
  }
  return null;
}

export function verificationDevicePhotosBlockReason(
  _row: VerificationSessionValues['devices'][number],
  index: number,
  images: DeviceVerificationImagesState,
  rvDocuments: DeviceRvDocumentsState | undefined,
  verificationType: VerificationSessionValues['verificationType'],
): string | null {
  const label = `Instrument ${index + 1}`;
  const imageError = validateDeviceVerificationImages(images, label, verificationType);
  if (imageError) return imageError;

  if (verificationType === 'RV') {
    return validateDeviceRvDocuments(rvDocuments ?? emptyDeviceRvDocumentsState(), label);
  }

  return null;
}

/** @deprecated Use verificationDevicePhotosBlockReason */
export const verificationEvidenceDeviceBlockReason = verificationDevicePhotosBlockReason;

export function verificationDeviceDetailsBlockReason(
  row: VerificationSessionValues['devices'][number],
  index: number,
  verificationType: VerificationSessionValues['verificationType'],
  product?: Product | null,
): string | null {
  return validateVerificationDeviceDetails(row, index, { verificationType, product });
}

function instrumentsDetailsBlockReason(
  values: VerificationSessionValues,
  context?: VerificationFormStepContext,
): string | null {
  const included = values.devices.filter(row => row.included);
  if (included.length === 0) return 'Add at least one instrument.';

  for (let i = 0; i < values.devices.length; i++) {
    const row = values.devices[i];
    if (!row.included) continue;
    const product =
      context?.products?.find(p => p.id === row.productId) ?? null;
    const detailsError = verificationDeviceDetailsBlockReason(
      row,
      i,
      values.verificationType,
      product,
    );
    if (detailsError) return detailsError;
  }

  return validateOvQuotaDevices(
    values.verificationType,
    included.map(row => row.serialNumber),
    context?.ovQuota,
  );
}

function instrumentsPhotosOnlyBlockReason(
  values: VerificationSessionValues,
  context?: VerificationFormStepContext,
): string | null {
  const included = values.devices.filter(row => row.included);
  if (included.length === 0) return 'Add at least one instrument.';

  const deviceImages = context?.deviceImages ?? {};
  const deviceRvImages = context?.deviceRvImages ?? {};

  for (let i = 0; i < values.devices.length; i++) {
    const row = values.devices[i];
    if (!row.included) continue;
    const photoError = verificationDevicePhotosBlockReason(
      row,
      i,
      deviceImages[row.localId] ?? emptyDeviceVerificationImagesState(),
      deviceRvImages[row.localId],
      values.verificationType,
    );
    if (photoError) return photoError;
  }

  return null;
}

function instrumentsStepBlockReason(
  values: VerificationSessionValues,
  context?: VerificationFormStepContext,
): string | null {
  const detailsError = instrumentsDetailsBlockReason(values, context);
  if (detailsError) return detailsError;
  return instrumentsPhotosOnlyBlockReason(values, context);
}

export function isVerificationFormStepComplete(
  stepId: VerificationFormStepId,
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
  context?: VerificationFormStepContext,
): boolean {
  return verificationFormStepBlockReason(stepId, values, rcProfile, context) === null;
}

function performerPhotosBlockReason(
  values: VerificationSessionValues,
  context?: VerificationFormStepContext,
): string | null {
  if (!requiresPerformerIdentityPhotos(values.verificationType)) return null;
  return validatePerformerPhotos(context?.performerPhotos ?? emptyPerformerPhotosState());
}

export function verificationFormStepBlockReason(
  stepId: VerificationFormStepId,
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
  context?: VerificationFormStepContext,
): string | null {
  if (stepId === 'setup') {
    if (values.verificationType !== 'OV' && values.verificationType !== 'RV') {
      return 'Select OV or RV.';
    }
    if (values.verificationSubject !== 'self' && values.verificationSubject !== 'customer') {
      return 'Choose Self or Customer.';
    }
    const partyReason = partyStepBlockReason(values, rcProfile, context);
    if (partyReason) return partyReason;
    // Compact OV/RV Customer: temp/humidity checked on Submit, not here.
    if (
      values.verificationSubject === 'customer'
      && context?.isNewJob
      && (values.verificationType === 'OV' || values.verificationType === 'RV')
    ) {
      return validateOvQuotaSetup(values.verificationType, context?.ovQuota, true);
    }
    const siteReason = siteStepBlockReason(values);
    if (siteReason) return siteReason;
    return validateOvQuotaSetup(values.verificationType, context?.ovQuota, Boolean(context?.isNewJob));
  }

  if (stepId === 'product') {
    return instrumentsDetailsBlockReason(values, context);
  }

  if (stepId === 'site') {
    const partyReason = partyStepBlockReason(values, rcProfile, context);
    if (partyReason) return partyReason;
    return siteStepBlockReason(values);
  }

  if (stepId === 'photos') {
    return instrumentsPhotosOnlyBlockReason(values, context);
  }

  if (stepId === 'instruments') {
    return instrumentsStepBlockReason(values, context);
  }

  if (stepId === 'review') {
    const instrumentsReason = instrumentsStepBlockReason(values, context);
    if (instrumentsReason) return instrumentsReason;
    const siteReason = siteStepBlockReason(values);
    if (siteReason) return siteReason;
    return performerPhotosBlockReason(values, context);
  }

  return null;
}

export function findInitialVerificationFormStep(
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
  readOnly: boolean,
  context?: VerificationFormStepContext,
): number {
  if (readOnly) return 0;
  for (let i = 0; i < VERIFICATION_FORM_STEPS.length; i++) {
    if (!isVerificationFormStepComplete(VERIFICATION_FORM_STEPS[i].id, values, rcProfile, context)) {
      return i;
    }
  }
  return VERIFICATION_FORM_STEPS.length - 1;
}
