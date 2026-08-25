import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { FirestoreUserDoc } from '../types';

export const RC_ACCOUNT_INACTIVE_LOGIN_MESSAGE =
  'This regional center account is deactivated. Contact Super Admin.';

export const RC_INACTIVE_LOGIN_MESSAGE =
  'Your regional center is inactive. Super Admin must upload your standard weights certificate before you can sign in.';

/** Super Admin uploaded standard weights certificate on the RC profile. */
export function rcHasStandardWeightsCert(
  doc: Pick<FirestoreUserDoc, 'standardWeightsCertUrl' | 'standardWeightsCertPath'>,
): boolean {
  return Boolean(doc.standardWeightsCertUrl?.trim() || doc.standardWeightsCertPath?.trim());
}

/** Super Admin can disable an RC without deleting the account. Omitted/true = enabled. */
export function isRcAccountActive(doc: Pick<FirestoreUserDoc, 'active'>): boolean {
  return doc.active !== false;
}

/** @deprecated Use rcHasStandardWeightsCert — kept for admin cert Active/Inactive badge. */
export const isRcActive = rcHasStandardWeightsCert;

export function rcActivationLabel(
  doc: Pick<FirestoreUserDoc, 'standardWeightsCertUrl' | 'standardWeightsCertPath' | 'active'>,
): string {
  if (!isRcAccountActive(doc)) return 'Deactivated';
  return rcHasStandardWeightsCert(doc) ? 'Active' : 'Inactive';
}

export const VCT_RC_WEIGHTS_CERT_REQUIRED_MESSAGE =
  'Your regional centre\'s standard weights certificate has not been uploaded yet. RC admin: Profile → Edit → upload certificate. VCT cannot start new verifications until then.';

export async function fetchRcHasStandardWeightsCert(rcId: string): Promise<boolean> {
  if (!rcId.trim()) return false;
  const snap = await getDoc(doc(db, 'users', rcId));
  if (!snap.exists()) return false;
  return rcHasStandardWeightsCert(snap.data() as FirestoreUserDoc);
}
