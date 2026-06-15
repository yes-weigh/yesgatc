import type { FirestoreUserDoc } from '../types';
import type { VerificationDeviceRowValues } from './siteCalibrationProfileFields';
import {
  formatLaboratorySealId,
  LABORATORY_SEAL_QUARTER_HINT,
  parseLaboratorySealSequence,
} from './laboratorySealId';

export const DEFAULT_LABORATORY_SEAL_IDENTIFICATION = formatLaboratorySealId(26);

export type LaboratorySettings = {
  sealIdentification: string;
};

export type LaboratoryFieldKey = keyof LaboratorySettings;

export type LaboratoryFieldDef = {
  key: LaboratoryFieldKey;
  label: string;
  hint: string;
  mono?: boolean;
};

/** Registry — add new laboratory fields here and extend LaboratorySettings. */
export const LABORATORY_FIELDS: LaboratoryFieldDef[] = [
  {
    key: 'sealIdentification',
    label: 'Seal ID',
    hint: LABORATORY_SEAL_QUARTER_HINT,
    mono: true,
  },
];

export const EMPTY_LABORATORY_SETTINGS: LaboratorySettings = {
  sealIdentification: DEFAULT_LABORATORY_SEAL_IDENTIFICATION,
};

export function resolveLaboratorySealIdentification(
  doc?: Pick<FirestoreUserDoc, 'laboratorySealIdentification'> | null,
  referenceDate: Date = new Date(),
): string {
  const sequence = parseLaboratorySealSequence(doc?.laboratorySealIdentification);
  return formatLaboratorySealId(sequence, referenceDate);
}

export function laboratorySettingsFromUser(
  doc?: Pick<FirestoreUserDoc, 'laboratorySealIdentification'> | null,
  referenceDate: Date = new Date(),
): LaboratorySettings {
  return {
    sealIdentification: resolveLaboratorySealIdentification(doc, referenceDate),
  };
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
