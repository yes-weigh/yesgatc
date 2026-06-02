import type { FirestoreUserDoc } from '../types';
import type { VerificationSessionValues } from './siteCalibrationProfileFields';

export type VerificationFormStepId = 'type' | 'party_site' | 'devices';

export type VerificationFormStepDef = {
  id: VerificationFormStepId;
  label: string;
  shortLabel: string;
  description: string;
};

export const VERIFICATION_FORM_STEPS: VerificationFormStepDef[] = [
  {
    id: 'type',
    label: 'Verification type',
    shortLabel: 'Type',
    description: 'Choose original or re-verification and who this request belongs to.',
  },
  {
    id: 'party_site',
    label: 'Party & site',
    shortLabel: 'Details',
    description: 'Confirm the party, location, and ambient conditions.',
  },
  {
    id: 'devices',
    label: 'Devices & evidence',
    shortLabel: 'Devices',
    description: 'Select devices, enter readings, and attach required photos or documents.',
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
  if (stepId === 'type') {
    if (values.verificationType !== 'OV' && values.verificationType !== 'RV') {
      return 'Select Original Verification or Re-verification.';
    }
    if (values.verificationSubject !== 'self' && values.verificationSubject !== 'customer') {
      return 'Choose whether this verification is for Self or a Customer.';
    }
    return null;
  }

  if (stepId === 'party_site') {
    const partyReason = partyStepBlockReason(values, rcProfile);
    if (partyReason) return partyReason;
    return siteStepBlockReason(values);
  }

  if (values.devices.filter(row => row.included).length === 0) {
    return 'Select at least one device to include.';
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
