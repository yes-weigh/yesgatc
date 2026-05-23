/** Contact email & phone — stored on user profiles, not used for login. */

export const PHONE_REGEX = /^\d{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}

export function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(normalizePhone(phone));
}

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return true; // optional when empty
  return EMAIL_REGEX.test(trimmed);
}

export function requireValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && EMAIL_REGEX.test(trimmed);
}

/** Subtitle for header chip: prefer phone, then email, then formatted aadhar hint */
export function formatContactSubtitle(user: {
  phone?: string;
  email?: string;
  aadhar?: string;
}): string {
  if (user.phone?.trim()) return user.phone.trim();
  if (user.email?.trim()) return user.email.trim();
  return user.aadhar ? `Aadhar · ${user.aadhar}` : '';
}

/** Label for technician dropdowns / lists */
export function formatTechnicianLabel(tech: {
  username?: string;
  phone?: string;
  email?: string;
  aadhar?: string;
}): string {
  const name = tech.username?.trim() || 'Technician';
  const contact = tech.phone?.trim() || tech.email?.trim();
  return contact ? `${name} (${contact})` : name;
}
