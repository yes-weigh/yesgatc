import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { buildRvSubmitTestRevertMessage } from './rvSubmitTestRevert';
import { normalizeVerificationStatus } from './verificationRequest';
import type { SiteCalibration } from '../types';

const FUNCTIONS_REGION = 'us-central1';

export type SubmittedVerificationDeleteActor = {
  role?: string | null;
  uid?: string | null;
  rcId?: string | null;
};

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

function hasIssuedCertificate(record: SiteCalibration): boolean {
  return Boolean(
    record.approvedAt
    || record.certifiedAt
    || record.certificateNumber?.trim(),
  );
}

function isSubmittedVerificationRecord(record: SiteCalibration): boolean {
  const status = normalizeVerificationStatus(record);
  if (status !== 'submitted') return false;
  if (hasIssuedCertificate(record)) return false;
  return record.verificationType === 'OV' || record.verificationType === 'RV';
}

export function isDeletableSubmittedOriginalVerification(record: SiteCalibration): boolean {
  if (record.verificationType !== 'OV') return false;
  if (hasIssuedCertificate(record)) return false;
  const status = normalizeVerificationStatus(record);
  return status === 'submitted' || status === 'pending_rc';
}

export function canDeleteSubmittedOriginalVerification(
  record: SiteCalibration,
  actor: SubmittedVerificationDeleteActor,
): boolean {
  if (!isDeletableSubmittedOriginalVerification(record)) return false;

  const role = actor.role;
  const uid = actor.uid?.trim();
  if (role === 'super_admin' && uid) return true;
  if (role === 'rc_admin' && uid && record.rcId === uid) return true;
  if ((role === 'vct' || role === 'verifier') && uid) {
    const owns = record.createdByUid === uid || record.vctId === uid;
    const sameRc = Boolean(actor.rcId && record.rcId === actor.rcId);
    return owns && sameRc;
  }
  return false;
}

export function canDevDeleteSubmittedVerification(
  record: SiteCalibration,
  isSuperAdmin: boolean,
): boolean {
  if (!import.meta.env.DEV || !isSuperAdmin) return false;
  return isSubmittedVerificationRecord(record);
}

export function canWipeSubmittedVerification(
  record: SiteCalibration,
  actor: SubmittedVerificationDeleteActor,
  isSuperAdmin: boolean,
): boolean {
  return (
    canDeleteSubmittedOriginalVerification(record, actor)
    || canDevDeleteSubmittedVerification(record, isSuperAdmin)
  );
}

export function collectSubmittedDeleteBatchForDisplay(
  anchor: SiteCalibration,
  allRecords: SiteCalibration[],
): SiteCalibration[] {
  if (anchor.verificationType === 'OV') return [anchor];
  if (normalizeVerificationStatus(anchor) !== 'submitted') return [anchor];

  const submittedAt = anchor.submittedAt;
  const rcId = anchor.rcId;
  if (!submittedAt || !rcId) return [anchor];

  const batch = allRecords.filter(
    record =>
      record.rcId === rcId
      && record.submittedAt === submittedAt
      && record.verificationType === 'RV'
      && normalizeVerificationStatus(record) === 'submitted'
      && !record.approvedAt
      && !record.certifiedAt
      && !record.certificateNumber?.trim(),
  );

  return batch.length ? batch : [anchor];
}

export function buildDevDeleteSubmittedMessage(
  batch: SiteCalibration[],
  rcName: string,
): string {
  if (batch.length === 1 && batch[0].verificationType === 'OV') {
    const record = batch[0];
    const appNo = record.applicationNumber?.trim() || '—';
    const serial = record.serialNumber?.trim() || '—';
    return [
      `Delete OV App ${appNo} (serial ${serial})?`,
      '',
      `Serial ${serial} returns to unused. Original Verification can be done on this number later.`,
    ].join('\n');
  }

  return buildRvSubmitTestRevertMessage(batch, rcName);
}

export function verificationAdminDeleteLabel(
  record: SiteCalibration,
  isSuperAdmin: boolean,
): string {
  if (isDeletableSubmittedOriginalVerification(record)) {
    return 'Delete OV';
  }
  if (canDevDeleteSubmittedVerification(record, isSuperAdmin)) {
    return 'Delete submitted (dev)';
  }
  return 'Remove draft';
}

export async function devDeleteSubmittedVerification(recordId: string): Promise<{
  recordId: string;
  deletedRecordIds: string[];
  deletedCount: number;
  walletPaymentsCleared: number;
  deleted: boolean;
}> {
  const fn = httpsCallable<
    { recordId: string },
    {
      recordId: string;
      deletedRecordIds: string[];
      deletedCount: number;
      walletPaymentsCleared: number;
      deleted: boolean;
    }
  >(functionsClient(), 'devDeleteSubmittedVerification');

  const result = await fn({ recordId });
  return result.data;
}
