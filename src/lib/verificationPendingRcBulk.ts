import type { Role, SiteCalibration } from '../types.ts';

function isVerifierPerformed(
  record: Pick<SiteCalibration, 'performedBy' | 'requestSource'>,
): boolean {
  return record.performedBy === 'verifier' || record.requestSource === 'verifier_manual';
}

export type PendingRcBulkSkip = {
  id: string;
  serialNumber: string;
  applicationNumber: string;
  reason: string;
};

export type PendingRcBulkPlan<T extends SiteCalibration = SiteCalibration> = {
  approveAndSubmit: T[];
  ignored: PendingRcBulkSkip[];
};

function skipFrom(
  record: Pick<SiteCalibration, 'id' | 'serialNumber' | 'applicationNumber'>,
  reason: string,
): PendingRcBulkSkip {
  return {
    id: record.id,
    serialNumber: record.serialNumber?.trim() || '',
    applicationNumber: record.applicationNumber?.trim() || '',
    reason,
  };
}

function skipLabel(skip: PendingRcBulkSkip): string {
  const app = skip.applicationNumber || '—';
  const serial = skip.serialNumber || '(no serial)';
  return `App ${app} serial ${serial}`;
}

/** Same gate as single-row Approve: `pending_rc` + verifier work. */
export function isPendingRcSubmitEligible(
  record: Pick<SiteCalibration, 'status' | 'performedBy' | 'requestSource'>,
): boolean {
  return record.status === 'pending_rc' && isVerifierPerformed(record);
}

export function filterPendingRcSubmitTargets<T extends SiteCalibration>(records: T[]): T[] {
  return records.filter(isPendingRcSubmitEligible);
}

export function canActorBulkSubmitPendingRc(role?: Role | string | null): boolean {
  return role === 'rc_admin' || role === 'super_admin';
}

/**
 * Partition a list for Pending RC select-all + submit.
 * Only verifier `pending_rc` jobs are queued (same as single-row Approve).
 * Draft / fail-at-submit / certified / unsigned / rejected stay out.
 */
export function planPendingRcBulkSubmit<T extends SiteCalibration>(records: T[]): PendingRcBulkPlan<T> {
  const approveAndSubmit: T[] = [];
  const ignored: PendingRcBulkSkip[] = [];

  for (const record of records) {
    if (isPendingRcSubmitEligible(record)) {
      approveAndSubmit.push(record);
      continue;
    }
    ignored.push(skipFrom(record, 'not pending RC'));
  }

  return { approveAndSubmit, ignored };
}

export function pendingRcBulkHasWork(plan: PendingRcBulkPlan): boolean {
  return plan.approveAndSubmit.length > 0;
}

export function formatPendingRcBulkConfirmMessage(plan: PendingRcBulkPlan): string {
  const n = plan.approveAndSubmit.length;
  const lines = [
    `Approve ${n} pending RC job${n === 1 ? '' : 's'} and submit for certificate generation.`,
    'Same path as single-row Approve: RC stamp, then eMAAP submit.',
  ];
  if (plan.ignored.length > 0) {
    lines.push('');
    lines.push('Skipped (not pending RC):');
    const shown = plan.ignored.slice(0, 12);
    for (const skip of shown) {
      lines.push(`• ${skipLabel(skip)} — ${skip.reason}`);
    }
    const extra = plan.ignored.length - shown.length;
    if (extra > 0) lines.push(`• … +${extra} more`);
  }
  lines.push('');
  lines.push('Does not touch draft, fail-at-submit, or certified jobs.');
  return lines.join('\n');
}
