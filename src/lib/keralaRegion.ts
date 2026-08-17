import { isValidPincode, normalizePincode } from './contactFields';

/** Kerala PIN circles: 67xxxx, 68xxxx, 69xxxx. */
export const KERALA_STATE = 'Kerala';
const KERALA_PIN_PREFIXES = new Set(['67', '68', '69']);

export function isKeralaState(state: string | null | undefined): boolean {
  return (state?.trim() || '').toLowerCase() === KERALA_STATE.toLowerCase();
}

export function isKeralaPincode(pincode: string | null | undefined): boolean {
  const pin = normalizePincode(pincode ?? '');
  return isValidPincode(pin) && KERALA_PIN_PREFIXES.has(pin.slice(0, 2));
}

/**
 * GATC / eMAAP filing is Kerala-only. Customer PIN outside Kerala → certificate
 * belongs-to is the RC centre.
 */
export function shouldFileCertificateAsRc(input: {
  verificationSubject?: string | null;
  pincode?: string | null;
  state?: string | null;
}): boolean {
  if (input.verificationSubject === 'self') return false;
  const pin = normalizePincode(input.pincode ?? '');
  if (isValidPincode(pin)) return !isKeralaPincode(pin);
  const state = input.state?.trim() || '';
  if (!state) return false;
  return !isKeralaState(state);
}

export type RcFilingPartyPatch = {
  fileCertificateAsRc: boolean;
  verificationSubject?: 'self';
  customerId?: string;
  customerName?: string;
  sourceCustomerId?: string;
  sourceCustomerName?: string;
};

/** Rewrite stored party to RC centre name when customer PIN is outside Kerala. */
export function rcFilingPartyPatch(input: {
  verificationSubject?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  pincode?: string | null;
  state?: string | null;
  rcUid?: string | null;
  rcCompanyName?: string | null;
}): RcFilingPartyPatch {
  const fileCertificateAsRc = shouldFileCertificateAsRc({
    verificationSubject: input.verificationSubject,
    pincode: input.pincode,
    state: input.state,
  });
  const rcUid = input.rcUid?.trim() || '';
  const rcName = input.rcCompanyName?.trim() || '';
  if (!fileCertificateAsRc || !rcUid || !rcName) {
    return { fileCertificateAsRc };
  }
  const sourceId = input.customerId?.trim() || '';
  const sourceName = input.customerName?.trim() || '';
  return {
    fileCertificateAsRc: true,
    verificationSubject: 'self',
    customerId: rcUid,
    customerName: rcName,
    ...(sourceId && sourceId !== rcUid ? { sourceCustomerId: sourceId } : {}),
    ...(sourceName && sourceName !== rcName ? { sourceCustomerName: sourceName } : {}),
  };
}
