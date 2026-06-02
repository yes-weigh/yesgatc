import type { FirestoreUserDoc } from '../types';
import {
  validateVerificationDeviceDetails,
  type VerificationSessionValues,
} from './siteCalibrationProfileFields';

export type VerificationFormStepId = 'setup' | 'devices' | 'evidence';

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
    id: 'devices',
    label: 'Devices',
    shortLabel: 'Devices',
    description: 'Select devices and enter serial numbers, MPE, and seal details.',
  },
  {
    id: 'evidence',
    label: 'Evidence',
    shortLabel: 'Photos',
    description: 'Attach verification photos and documents for each selected device.',
  },
];

function partyStepBlockReason(
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
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
  if (!values.customerId.trim()) return 'Select a customer to continue.';
  return null;
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

function devicesStepBlockReason(values: VerificationSessionValues): string | null {
  const included = values.devices.filter(row => row.included);
  if (included.length === 0) return 'Select at least one device.';

  for (let i = 0; i < values.devices.length; i++) {
    const row = values.devices[i];
    if (!row.included) continue;
    const rowError = validateVerificationDeviceDetails(row, i, {
      verificationType: values.verificationType,
    });
    if (rowError) return rowError;
  }

  return null;
}

export function isVerificationFormStepComplete(
  stepId: VerificationFormStepId,
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
): boolean {
  return verificationFormStepBlockReason(stepId, values, rcProfile) === null;
}

export function verificationFormStepBlockReason(
  stepId: VerificationFormStepId,
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
): string | null {
  if (stepId === 'setup') {
    if (values.verificationType !== 'OV' && values.verificationType !== 'RV') {
      return 'Select OV or RV.';
    }
    if (values.verificationSubject !== 'self' && values.verificationSubject !== 'customer') {
      return 'Choose Self or Customer.';
    }
    const partyReason = partyStepBlockReason(values, rcProfile);
    if (partyReason) return partyReason;
    return siteStepBlockReason(values);
  }

  if (stepId === 'devices') {
    return devicesStepBlockReason(values);
  }

  if (stepId === 'evidence') {
    if (values.devices.filter(row => row.included).length === 0) {
      return 'Select at least one device on the previous step.';
    }
    return null;
  }

  return null;
}

export function findInitialVerificationFormStep(
  values: VerificationSessionValues,
  rcProfile: FirestoreUserDoc | null | undefined,
  readOnly: boolean,
): number {
  if (readOnly) return 0;
  for (let i = 0; i < VERIFICATION_FORM_STEPS.length; i++) {
    if (!isVerificationFormStepComplete(VERIFICATION_FORM_STEPS[i].id, values, rcProfile)) {
      return i;
    }
  }
  return VERIFICATION_FORM_STEPS.length - 1;
}
