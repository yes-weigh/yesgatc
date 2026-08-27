import type { Role } from '../types';
import { isMobileTouchDevice, isPwaStandalone } from './imageCapture';

export const VERIFICATION_MOBILE_ONLY_NOTICE =
  'OV and RV verifications must be done on the YESGATC mobile app. Open this site on your phone, add YES LAB to your home screen, then start verification there. Desktop is for viewing records only.';

export const RC_PROFILE_GPS_REQUIRED_MESSAGE =
  'RC centre GPS is required before starting desktop verification.';

export const RC_PROFILE_GPS_REQUIRED_RC_HINT =
  'Set coordinates under Profile → Edit.';

export const RC_PROFILE_GPS_REQUIRED_VCT_HINT =
  'Ask your RC admin to set centre coordinates under Profile → Edit.';

/** Phone / tablet / installed PWA — field capture device (live GPS). */
export function isVerificationCaptureDevice(): boolean {
  return isPwaStandalone() || isMobileTouchDevice();
}

/** No role is mobile-only; OV/RV allowed on PC and mobile for VCT and RC. */
export function verificationRequiresMobileCapture(_role: Role | undefined): boolean {
  return false;
}

/** Whether this role may start or edit verification capture (photos, submit). */
export function canUseVerificationCapture(role: Role | undefined): boolean {
  return role === 'rc_admin' || role === 'vct' || role === 'verifier';
}
