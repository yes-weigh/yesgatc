import type { FirestoreUserDoc } from '../types';

export const VERIFIER_INACTIVE_LOGIN_MESSAGE =
  'Your verifier account has been disabled. Contact your Regional Center.';

export function isVerifierActive(doc: Pick<FirestoreUserDoc, 'active'>): boolean {
  return doc.active !== false;
}

export function verifierActiveLabel(active?: boolean): string {
  return isVerifierActive({ active }) ? 'Active' : 'Inactive';
}
