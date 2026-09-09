import type { Role } from '../types';

/**
 * Owner of `serialAllotments` / Yesone quota. Field staff use parent RC uid (`rcId`),
 * never their own uid — allotments are not stored under the verifier/VCT.
 */
export function parentRcUid(user: {
  role?: Role | null;
  uid?: string | null;
  rcId?: string | null;
} | null | undefined): string | null {
  if (!user?.role) return null;
  const uid = String(user.uid || '').trim();
  const rcId = String(user.rcId || '').trim();
  if (user.role === 'rc_admin') return uid || null;
  if (user.role === 'vct' || user.role === 'verifier') {
    if (!rcId) return null;
    if (uid && rcId === uid) return null;
    return rcId;
  }
  return null;
}
