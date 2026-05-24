import type { FirestoreUserDoc } from '../types';

export const RC_INACTIVE_LOGIN_MESSAGE =
  'Your regional center is inactive. Super Admin must upload your standard weights certificate before you can sign in.';

/** Matches Active/Inactive badge in Super Admin RC list. */
export function isRcActive(
  doc: Pick<FirestoreUserDoc, 'standardWeightsCertUrl' | 'standardWeightsCertPath'>,
): boolean {
  return Boolean(doc.standardWeightsCertUrl?.trim() || doc.standardWeightsCertPath?.trim());
}

export function rcActivationLabel(
  doc: Pick<FirestoreUserDoc, 'standardWeightsCertUrl' | 'standardWeightsCertPath'>,
): string {
  return isRcActive(doc) ? 'Active' : 'Inactive';
}
