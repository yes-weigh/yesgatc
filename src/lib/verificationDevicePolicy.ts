import type { Role } from '../types';
import { isMobileTouchDevice, isPwaStandalone } from './imageCapture';

export const VERIFICATION_MOBILE_ONLY_NOTICE =
  'OV and RV verifications must be done on the YESGATC mobile app. Open this site on your phone, add YES LAB to your home screen, then start verification there. Desktop is for viewing records only.';

export const RC_PROFILE_GPS_REQUIRED_MESSAGE =
  'Set GPS coordinates on your RC profile before starting desktop verification.';

/** Phone / tablet / installed PWA — field capture device for VCT. */
export function isVerificationCaptureDevice(): boolean {
  return isPwaStandalone() || isMobileTouchDevice();
}

/** VCT must use mobile/PWA; RC admin may verify from desktop. */
export function verificationRequiresMobileCapture(role: Role | undefined): boolean {
  return role !== 'rc_admin';
}

/** Whether this role may start or edit verification capture (photos, submit). */
export function canUseVerificationCapture(role: Role | undefined): boolean {
  if (role === 'rc_admin') return true;
  return isVerificationCaptureDevice();
}
