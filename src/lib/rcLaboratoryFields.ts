import type { FirestoreUserDoc } from '../types';
import type { VerificationDeviceRowValues } from './siteCalibrationProfileFields';

export const DEFAULT_LABORATORY_SEAL_IDENTIFICATION = 'IND/KL/26/04/B26';

export function resolveLaboratorySealIdentification(
  doc?: Pick<FirestoreUserDoc, 'laboratorySealIdentification'> | null,
): string {
  const value = doc?.laboratorySealIdentification?.trim();
  return value || DEFAULT_LABORATORY_SEAL_IDENTIFICATION;
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
