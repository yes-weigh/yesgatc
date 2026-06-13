import type { FirestoreUserDoc } from '../types';
import { isPendingNewCustomerParty, type CustomerFormValues } from './customerProfileFields';
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

export type VerificationFormStepId = 'setup' | 'instruments' | 'review';

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

export type VerificationFormStepContext = {
  customerForm?: CustomerFormValues;
  deviceImages?: Record<string, DeviceVerificationImagesState>;
  deviceRvImages?: Record<string, DeviceRvDocumentsState>;
  performerPhotos?: PerformerPhotosState;
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
    return null;
  }
  if (values.customerId.trim()) return null;
  if (context?.customerForm && isPendingNewCustomerParty(context.customerForm)) return null;
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
): string | null {
  return validateVerificationDeviceDetails(row, index, { verificationType });
}

function instrumentsStepBlockReason(
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

    const detailsError = verificationDeviceDetailsBlockReason(row, i, values.verificationType);
    if (detailsError) return detailsError;
  }

  return null;
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
    const siteReason = siteStepBlockReason(values);
    if (siteReason) return siteReason;
    return null;
  }

  if (stepId === 'instruments') {
    return instrumentsStepBlockReason(values, context);
  }

  if (stepId === 'review') {
    const instrumentsReason = instrumentsStepBlockReason(values, context);
    if (instrumentsReason) return instrumentsReason;
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
