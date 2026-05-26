import type { FirestoreUserDoc } from '../types';
import type { VerificationDeviceRowValues } from './siteCalibrationProfileFields';

export const DEFAULT_LABORATORY_SEAL_IDENTIFICATION = 'IND/KL/26/04/B26';

export type LaboratorySettings = {
  sealIdentification: string;
};

export type LaboratoryFieldKey = keyof LaboratorySettings;

export type LaboratoryFieldDef = {
  key: LaboratoryFieldKey;
  label: string;
  hint: string;
  placeholder: string;
  mono?: boolean;
};

/** Registry — add new laboratory fields here and extend LaboratorySettings. */
export const LABORATORY_FIELDS: LaboratoryFieldDef[] = [
  {
    key: 'sealIdentification',
    label: 'Seal ID',
    hint: 'Prefilled on every verification device',
    placeholder: DEFAULT_LABORATORY_SEAL_IDENTIFICATION,
    mono: true,
  },
];

export const EMPTY_LABORATORY_SETTINGS: LaboratorySettings = {
  sealIdentification: DEFAULT_LABORATORY_SEAL_IDENTIFICATION,
};

export function resolveLaboratorySealIdentification(
  doc?: Pick<FirestoreUserDoc, 'laboratorySealIdentification'> | null,
): string {
  const value = doc?.laboratorySealIdentification?.trim();
  return value || DEFAULT_LABORATORY_SEAL_IDENTIFICATION;
}

export function laboratorySettingsFromUser(
  doc?: Pick<FirestoreUserDoc, 'laboratorySealIdentification'> | null,
): LaboratorySettings {
  return {
    sealIdentification: resolveLaboratorySealIdentification(doc),
  };
}

export function buildLaboratorySettingsPatch(
  values: LaboratorySettings,
): Pick<FirestoreUserDoc, 'laboratorySealIdentification'> {
  return {
    laboratorySealIdentification: values.sealIdentification.trim(),
  };
}

export function validateLaboratorySettings(values: LaboratorySettings): string | null {
  if (!values.sealIdentification.trim()) return 'Seal ID is required.';
  return null;
}

export function applyLaboratorySealToDeviceRows(
  devices: VerificationDeviceRowValues[],
  sealIdentification: string,
): VerificationDeviceRowValues[] {
  return devices.map(device => ({
    ...device,
    sealIdentificationNumber: sealIdentification,
  }));
}
