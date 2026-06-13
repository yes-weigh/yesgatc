import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

export function canCreateVerification(role: Role | undefined): boolean {
  return role === 'vct';
}

export function useRoleBasePath(): string {
  const { user } = useAuth();
  if (user?.role === 'vct') return '/vct';
  if (user?.role === 'rc_admin') return '/rc';
  if (user?.role === 'super_admin') return '/admin';
  return '';
}

export function useRcScope() {
  const { user } = useAuth();
  const isVct = user?.role === 'vct';
  const isRcAdmin = user?.role === 'rc_admin';
  const rcUid = isRcAdmin ? user?.uid ?? null : isVct ? user?.rcId ?? null : null;
  const actorUid = user?.uid ?? null;
  return { rcUid, actorUid, isVct, isRcAdmin, user };
}
