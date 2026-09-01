import { APP_VERSION, APP_VERSION_CODE } from './appVersion';

export const VERIFICATION_APP_UPDATE_REQUIRED_MESSAGE =
  'Update YesGATC to the latest version to create OV and RV verifications.';

/** Fields stamped on every siteCalibration create/update from this app build. */
export function verificationClientVersionFields(): {
  clientAppVersion: string;
  clientAppVersionCode: number;
} {
  return {
    clientAppVersion: APP_VERSION,
    clientAppVersionCode: APP_VERSION_CODE,
  };
}

export function isVerificationAppVersionAllowed(minCode: number): boolean {
  const min = Number.isFinite(minCode) && minCode > 0 ? Math.floor(minCode) : 0;
  return APP_VERSION_CODE >= min;
}
