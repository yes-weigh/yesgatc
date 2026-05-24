import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
} from 'firebase/auth';
import { secondaryAuth } from '../firebase';
import { assertAadharIndexAvailable } from './aadharIndex';

/**
 * Internal Firebase Auth identifier only (`{aadhar}@yesgatc.auth`).
 * Not the same as profile `email` — contact email is stored separately in Firestore.
 */
export const AUTH_EMAIL_DOMAIN = 'yesgatc.auth';

export const AADHAR_REGEX = /^\d{12}$/;

export function normalizeAadhar(input: string): string {
  return input.replace(/\D/g, '');
}

export function isValidAadhar(aadhar: string): boolean {
  return AADHAR_REGEX.test(normalizeAadhar(aadhar));
}

export function authEmailForAadhar(aadhar: string): string {
  return `${normalizeAadhar(aadhar)}@${AUTH_EMAIL_DOMAIN}`;
}

export function formatAadharDisplay(aadhar: string): string {
  const d = normalizeAadhar(aadhar);
  if (d.length !== 12) return d;
  return `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;
}

export async function assertAadharAvailable(aadhar: string, excludeUid?: string): Promise<void> {
  await assertAadharIndexAvailable(aadhar, excludeUid);
}

export async function createAuthUserForAadhar(aadhar: string, password: string) {
  const email = authEmailForAadhar(aadhar);
  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await secondaryAuth.signOut();
  return cred;
}

/** Sync Firebase Auth password when an admin resets credentials (uses stored current password). */
export async function syncAuthPassword(
  aadhar: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const email = authEmailForAadhar(aadhar);
  const cred = await signInWithEmailAndPassword(secondaryAuth, email, currentPassword);
  await updatePassword(cred.user, newPassword);
  await secondaryAuth.signOut();
}

export function authErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const raw = err instanceof Error ? err.message : fallback;
  if (
    raw.includes('invalid-credential') ||
    raw.includes('wrong-password') ||
    raw.includes('user-not-found')
  ) {
    return 'Invalid Aadhar number or password.';
  }
  if (raw.includes('email-already-in-use') || raw.includes('credential')) {
    return 'This Aadhar number is already registered.';
  }
  return raw;
}
