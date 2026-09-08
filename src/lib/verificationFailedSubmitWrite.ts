import { deleteField, doc, updateDoc, type Firestore, type UpdateData } from 'firebase/firestore';
import { verificationClientVersionFields } from './verificationAppVersion';
import type { FailedSubmitResubmitSource } from './verificationFailedSubmitResubmit';
import type { SiteCalibration, VerificationRequestStatus } from '../types';

export function buildFailedSubmitResubmitPatch(
  nowIso = new Date().toISOString(),
  source: Exclude<FailedSubmitResubmitSource, 'auto'> = 'manual',
): UpdateData<SiteCalibration> {
  return {
    status: 'submitted' satisfies VerificationRequestStatus,
    submittedAt: nowIso,
    updatedAt: nowIso,
    pipelineFailedPhase: deleteField(),
    pipelineFailureMessage: deleteField(),
    pipelineFailedAt: deleteField(),
    certificationLastError: deleteField(),
    lastFailedSubmitResubmitAt: nowIso,
    failedSubmitResubmitSource: source,
    ...verificationClientVersionFields(),
  };
}

export async function resubmitFailedSubmitVerifications(
  recordIds: string[],
  source: Exclude<FailedSubmitResubmitSource, 'auto'> = 'manual',
  firestore: Firestore,
): Promise<void> {
  const ids = [...new Set(recordIds.map(id => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  const patch = buildFailedSubmitResubmitPatch(new Date().toISOString(), source);
  await Promise.all(ids.map(id => updateDoc(doc(firestore, 'siteCalibrations', id), patch)));
}

export async function resubmitFailedSubmitVerification(
  recordId: string,
  source: Exclude<FailedSubmitResubmitSource, 'auto'> = 'manual',
  firestore: Firestore,
): Promise<void> {
  await resubmitFailedSubmitVerifications([recordId], source, firestore);
}
