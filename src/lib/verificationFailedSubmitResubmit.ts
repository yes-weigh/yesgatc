import type { Role, SiteCalibration } from '../types';

/**
 * Auto-resubmit cap for failed-at-submit jobs:
 * - Wait 12 hours after `pipelineFailedAt` (the last worker fail).
 * - Re-queue the **same** document (no clone, no new application/certificate number).
 * - Repeat at most FAILED_SUBMIT_AUTO_RESUBMIT_MAX (3) times.
 * - Stops earlier on success, rejected, move-to-draft, void, or superseded.
 * - Manual / bulk resubmit is not capped and does not increment `autoResubmitCount`.
 * Distinct from `moveStaleFailedVerificationsToDraft` (rejected → draft only).
 */
export const FAILED_SUBMIT_AUTO_RESUBMIT_AFTER_MS = 12 * 60 * 60 * 1000;
export const FAILED_SUBMIT_AUTO_RESUBMIT_MAX = 3;

export type FailedSubmitResubmitSource = 'manual' | 'bulk' | 'auto';

export type FailedSubmitResubmitFields = Pick<
  SiteCalibration,
  | 'id'
  | 'status'
  | 'pipelineFailedPhase'
  | 'pipelineFailedAt'
  | 'supersededByResubmissionId'
  | 'certificateVoidedAt'
  | 'signedCertificatePdfUrl'
  | 'autoResubmitCount'
  | 'rcId'
  | 'createdByUid'
  | 'vctId'
>;

function parseIsoMs(value: string | undefined): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isFailedAtSubmitJob(record: FailedSubmitResubmitFields): boolean {
  return record.status === 'submitted' && record.pipelineFailedPhase === 'submit';
}

/** Certified/approved jobs waiting for DSC sign — never a failed-at-submit resubmit. */
export function isUnsignedIssuedCertificate(
  record: Pick<SiteCalibration, 'status' | 'signedCertificatePdfUrl'>,
): boolean {
  const status = record.status;
  if (status !== 'certified' && status !== 'approved') return false;
  return !record.signedCertificatePdfUrl?.trim();
}

export function isEligibleFailedSubmitManualResubmit(
  record: FailedSubmitResubmitFields,
): boolean {
  if (record.status === 'rejected') return false;
  if (isUnsignedIssuedCertificate(record)) return false;
  if (record.status === 'certified' || record.status === 'approved' || record.status === 'draft') {
    return false;
  }
  if (record.supersededByResubmissionId?.trim()) return false;
  if (record.certificateVoidedAt?.trim()) return false;
  return isFailedAtSubmitJob(record);
}

export function isEligibleFailedSubmitAutoResubmit(
  record: FailedSubmitResubmitFields,
  nowMs: number,
): boolean {
  if (!isEligibleFailedSubmitManualResubmit(record)) return false;
  const count = Number(record.autoResubmitCount) || 0;
  if (count >= FAILED_SUBMIT_AUTO_RESUBMIT_MAX) return false;
  const failedAt = parseIsoMs(record.pipelineFailedAt);
  if (failedAt == null) return false;
  return nowMs - failedAt >= FAILED_SUBMIT_AUTO_RESUBMIT_AFTER_MS;
}

export function filterFailedSubmitResubmitTargets<T extends FailedSubmitResubmitFields>(
  records: T[],
): T[] {
  return records.filter(isEligibleFailedSubmitManualResubmit);
}

export function canActorResubmitFailedSubmit(
  record: FailedSubmitResubmitFields,
  actor: { role?: Role | string; uid?: string | null },
): boolean {
  if (!isEligibleFailedSubmitManualResubmit(record)) return false;
  if (actor.role === 'super_admin') return true;
  const uid = actor.uid?.trim();
  if (!uid) return false;
  if (actor.role === 'rc_admin') return record.rcId === uid;
  if (actor.role === 'vct') {
    return record.createdByUid === uid || record.vctId === uid;
  }
  return false;
}

export function canActorBulkResubmitFailedSubmit(role?: Role | string): boolean {
  return role === 'super_admin' || role === 'rc_admin';
}
