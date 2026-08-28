import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

/** RC admin, VCT, and Verifier may start OV Self / OV Customer / RV Customer jobs. */
export function canCreateVerification(role: Role | undefined): boolean {
  return role === 'vct' || role === 'rc_admin' || role === 'verifier';
}

export function useRoleBasePath(): string {
  const { user } = useAuth();
  if (user?.role === 'vct') return '/vct';
  if (user?.role === 'verifier') return '/verifier';
  if (user?.role === 'rc_admin') return '/rc';
  if (user?.role === 'super_admin') return '/admin';
  return '';
}

export function useRcScope() {
  const { user } = useAuth();
  const isVct = user?.role === 'vct';
  const isVerifier = user?.role === 'verifier';
  const isFieldStaff = isVct || isVerifier;
  const isRcAdmin = user?.role === 'rc_admin';
  const rcUid = isRcAdmin ? user?.uid ?? null : isFieldStaff ? user?.rcId ?? null : null;
  const actorUid = user?.uid ?? null;
  return { rcUid, actorUid, isVct, isVerifier, isFieldStaff, isRcAdmin, user };
}
