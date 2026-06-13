import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { FirestoreUserDoc } from '../types';

export const RC_INACTIVE_LOGIN_MESSAGE =
  'Your regional center is inactive. Super Admin must upload your standard weights certificate before you can sign in.';

/** Super Admin uploaded standard weights certificate on the RC profile. */
export function rcHasStandardWeightsCert(
  doc: Pick<FirestoreUserDoc, 'standardWeightsCertUrl' | 'standardWeightsCertPath'>,
): boolean {
  return Boolean(doc.standardWeightsCertUrl?.trim() || doc.standardWeightsCertPath?.trim());
}

/** @deprecated Use rcHasStandardWeightsCert — kept for admin Active/Inactive badge. */
export const isRcActive = rcHasStandardWeightsCert;

export function rcActivationLabel(
  doc: Pick<FirestoreUserDoc, 'standardWeightsCertUrl' | 'standardWeightsCertPath'>,
): string {
  return rcHasStandardWeightsCert(doc) ? 'Active' : 'Inactive';
}

export const VCT_RC_WEIGHTS_CERT_REQUIRED_MESSAGE =
  'Your regional centre\'s standard weights certificate has not been uploaded yet. Ask your RC admin — you cannot start new verifications until it is.';

export async function fetchRcHasStandardWeightsCert(rcId: string): Promise<boolean> {
  if (!rcId.trim()) return false;
  const snap = await getDoc(doc(db, 'users', rcId));
  if (!snap.exists()) return false;
  return rcHasStandardWeightsCert(snap.data() as FirestoreUserDoc);
}
