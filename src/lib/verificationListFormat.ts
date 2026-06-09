import { isValidVerificationIsoTimestamp } from './verificationRequest';

export function formatVerificationListDate(iso?: string): string {
  if (!isValidVerificationIsoTimestamp(iso)) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
