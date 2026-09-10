import { isEligibleFailedSubmitManualResubmit } from './verificationFailedSubmitResubmit.ts';
import type { SiteCalibration } from '../types.ts';

export type FailDraftBulkSkip = {
  id: string;
  serialNumber: string;
  applicationNumber: string;
  reason: string;
};

export type FailDraftBulkPlan<T extends SiteCalibration = SiteCalibration> = {
  failResubmit: T[];
  draftSubmit: T[];
  draftSkip: FailDraftBulkSkip[];
  ignored: FailDraftBulkSkip[];
};

export type FailDraftBulkOptions<T extends SiteCalibration> = {
  /** Same submit validation as list/detail (photos, serial, pincode). */
  draftBlockReason: (record: T) => string | null;
};

function skipFrom(
  record: Pick<SiteCalibration, 'id' | 'serialNumber' | 'applicationNumber'>,
  reason: string,
): FailDraftBulkSkip {
  return {
    id: record.id,
    serialNumber: record.serialNumber?.trim() || '',
    applicationNumber: record.applicationNumber?.trim() || '',
    reason,
  };
}

function skipLabel(skip: FailDraftBulkSkip): string {
  const app = skip.applicationNumber || '—';
  const serial = skip.serialNumber || '(no serial)';
  return `App ${app} serial ${serial}`;
}

/**
 * Partition jobs for the admin “Submit all Fail + eligible Draft” action.
 * Fail-at-submit uses the same-job resubmit path. Drafts use first-time submit.
 * Rejected / unsigned / certified / in-flight submitted are never queued.
 */
export function planFailAndDraftBulkSubmit<T extends SiteCalibration>(
  records: T[],
  options: FailDraftBulkOptions<T>,
): FailDraftBulkPlan<T> {
  const failResubmit: T[] = [];
  const draftSubmit: T[] = [];
  const draftSkip: FailDraftBulkSkip[] = [];
  const ignored: FailDraftBulkSkip[] = [];

  for (const record of records) {
    if (isEligibleFailedSubmitManualResubmit(record)) {
      failResubmit.push(record);
      continue;
    }

    if (record.status === 'draft') {
      const reason = options.draftBlockReason(record)?.trim() || null;
      if (reason) draftSkip.push(skipFrom(record, reason));
      else draftSubmit.push(record);
      continue;
    }

    ignored.push(skipFrom(record, 'not fail-at-submit or draft'));
  }

  return { failResubmit, draftSubmit, draftSkip, ignored };
}

export function canActorBulkSubmitFailAndDraft(role?: string | null): boolean {
  return role === 'super_admin';
}

export function failDraftBulkHasWork(plan: FailDraftBulkPlan): boolean {
  return plan.failResubmit.length > 0 || plan.draftSubmit.length > 0;
}

export function formatFailDraftBulkConfirmMessage(plan: FailDraftBulkPlan): string {
  const lines: string[] = [];
  const failN = plan.failResubmit.length;
  const draftN = plan.draftSubmit.length;

  if (failN > 0) {
    lines.push(
      `Re-queue ${failN} failed-at-submit job${failN === 1 ? '' : 's'} for eMAAP.`,
    );
    lines.push('Same certificate jobs. Application numbers are kept.');
  }
  if (draftN > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`Submit ${draftN} eligible draft${draftN === 1 ? '' : 's'} for first-time eMAAP.`);
  }
  if (plan.draftSkip.length > 0) {
    lines.push('');
    lines.push('Skipped drafts (incomplete — not submitted):');
    const shown = plan.draftSkip.slice(0, 12);
    for (const skip of shown) {
      lines.push(`• ${skipLabel(skip)} — ${skip.reason}`);
    }
    const extra = plan.draftSkip.length - shown.length;
    if (extra > 0) lines.push(`• … +${extra} more`);
  }
  lines.push('');
  lines.push('Does not touch rejected, unsigned, or certified jobs.');
  return lines.join('\n');
}
