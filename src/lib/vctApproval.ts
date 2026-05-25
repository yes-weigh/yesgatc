import type { FirestoreUserDoc } from '../types';

export const VCT_PENDING_LOGIN_MESSAGE =
  'Your profile has been created but is not yet approved. Please contact your Regional Center or Super Admin.';

export const VCT_INACTIVE_LOGIN_MESSAGE =
  'Your technician account has been disabled. Please contact your Regional Center.';

/** Legacy VCT profiles without approvalStatus are treated as approved. */
export function isVctApproved(doc: Pick<FirestoreUserDoc, 'approvalStatus'>): boolean {
  if (!doc.approvalStatus) return true;
  return doc.approvalStatus === 'approved';
}

/** Disabled VCTs cannot sign in or receive new job assignments. */
export function isVctActive(doc: Pick<FirestoreUserDoc, 'active'>): boolean {
  return doc.active !== false;
}

export function isVctOperational(
  doc: Pick<FirestoreUserDoc, 'approvalStatus' | 'active'>,
): boolean {
  return isVctApproved(doc) && isVctActive(doc);
}

export function vctApprovalLabel(status: FirestoreUserDoc['approvalStatus']): string {
  if (!status || status === 'approved') return 'Approved';
  return 'Pending approval';
}

export function vctActiveLabel(active?: boolean): string {
  return isVctActive({ active }) ? 'Enabled' : 'Disabled';
}
