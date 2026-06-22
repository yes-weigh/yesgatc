import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { buildRvSubmitTestRevertMessage } from './rvSubmitTestRevert';
import { normalizeVerificationStatus } from './verificationRequest';
import type { SiteCalibration } from '../types';

const FUNCTIONS_REGION = 'us-central1';

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

function isSubmittedVerificationRecord(record: SiteCalibration): boolean {
  const status = normalizeVerificationStatus(record);
  if (status !== 'submitted') return false;
  if (record.approvedAt || record.certifiedAt) return false;
  if (record.certificateNumber?.trim()) return false;
  return record.verificationType === 'OV' || record.verificationType === 'RV';
}

export function canDevDeleteSubmittedVerification(
  record: SiteCalibration,
  isSuperAdmin: boolean,
): boolean {
  if (!import.meta.env.DEV || !isSuperAdmin) return false;
  return isSubmittedVerificationRecord(record);
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
    const appNo = batch[0].applicationNumber?.trim() || '—';
    return [
      `Delete submitted OV verification App ${appNo}?`,
      '',
      'Firebase: removes this record from siteCalibrations.',
      'Zoho: remove any invoice manually if one was created.',
    ].join('\n');
  }

  return buildRvSubmitTestRevertMessage(batch, rcName);
}

export function verificationAdminDeleteLabel(
  record: SiteCalibration,
  isSuperAdmin: boolean,
): string {
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
