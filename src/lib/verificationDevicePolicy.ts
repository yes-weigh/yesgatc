import { isMobileTouchDevice, isPwaStandalone } from './imageCapture';

export const VERIFICATION_MOBILE_ONLY_NOTICE =
  'OV and RV verifications must be done on the YESGATC mobile app. Open this site on your phone, add YES LAB to your home screen, then start verification there. Desktop is for viewing records only.';

/** Phone / tablet / installed PWA — required for starting or editing OV·RV captures. */
export function isVerificationCaptureDevice(): boolean {
  return isPwaStandalone() || isMobileTouchDevice();
}
