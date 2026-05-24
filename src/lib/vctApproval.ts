import type { FirestoreUserDoc } from '../types';

export const VCT_PENDING_LOGIN_MESSAGE =
  'Your profile has been created but is not yet approved. Please contact your Regional Center or Super Admin.';

/** Legacy VCT profiles without approvalStatus are treated as approved. */
export function isVctApproved(doc: Pick<FirestoreUserDoc, 'approvalStatus'>): boolean {
  if (!doc.approvalStatus) return true;
  return doc.approvalStatus === 'approved';
}

export function vctApprovalLabel(status: FirestoreUserDoc['approvalStatus']): string {
  if (!status || status === 'approved') return 'Approved';
  return 'Pending approval';
}
