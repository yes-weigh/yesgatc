import type { VerificationStatusFilter } from './verificationRequest.ts';

const VERIFICATION_LIST_STATUS_QUERY_VALUES: VerificationStatusFilter[] = [
  'all',
  'draft',
  'pending_rc',
  'submitted',
  'certified',
  'failed_submit',
  'rejected',
  'duplicates',
];

/** Dashboard / list `?status=` — includes pending_rc (card click). */
export function parseVerificationListStatusParam(
  raw: string | null,
): VerificationStatusFilter | null {
  if (!raw) return null;
  if (raw === 'failed_certification') return 'failed_submit';
  if (raw === 'approved') return 'submitted';
  return VERIFICATION_LIST_STATUS_QUERY_VALUES.includes(raw as VerificationStatusFilter)
    ? (raw as VerificationStatusFilter)
    : null;
}

/** Pending RC matches dashboard raw tally — one row per job, not collapsed by serial. */
export function verificationListKeepsUncollapsedRows(
  statusFilter: VerificationStatusFilter,
): boolean {
  return statusFilter === 'pending_rc' || statusFilter === 'duplicates';
}
