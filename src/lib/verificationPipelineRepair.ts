import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  type UpdateData,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  inferVerificationStatus,
  isCorruptedFirestoreString,
  isCorruptedVerificationRecord,
  isVerificationFailedAtSubmit,
  isValidVerificationIsoTimestamp,
} from './verificationRequest';
import type { SiteCalibration, VerificationRequestStatus } from '../types';

function corruptedFieldCleanupPatch(
  record: Pick<
    SiteCalibration,
    'certificateNumber' | 'approvedAt' | 'updatedAt' | 'certifiedAt' | 'submittedAt'
  >,
): UpdateData<SiteCalibration> {
  const patch: UpdateData<SiteCalibration> = {};
  if (isCorruptedFirestoreString(record.certificateNumber)) {
    patch.certificateNumber = deleteField();
  }
  if (isCorruptedFirestoreString(record.approvedAt)) {
    patch.approvedAt = deleteField();
  }
  if (isCorruptedFirestoreString(record.updatedAt)) {
    patch.updatedAt = deleteField();
  }
  if (isCorruptedFirestoreString(record.certifiedAt)) {
    patch.certifiedAt = deleteField();
  }
  if (isCorruptedFirestoreString(record.submittedAt)) {
    patch.submittedAt = deleteField();
  }
  return patch;
}

export type PipelineRepairDiagnosis = {
  recordId: string;
  serialNumber: string;
  status: string;
  isCorrupted: boolean;
  /** Worker queue stage expectation (eMAAP: submitted → certified). */
  expectedPhase: 'pending' | 'complete' | 'unknown';
  queueEligible: boolean;
  repairAction: 'set_submitted' | 'fix_certified' | 'none';
  notes: string[];
};

export { isCorruptedFirestoreString, isCorruptedVerificationRecord };

export function diagnoseVerificationPipeline(record: SiteCalibration): PipelineRepairDiagnosis {
  const notes: string[] = [];
  const corrupted = isCorruptedVerificationRecord(record);
  const inferredStatus = inferVerificationStatus(record);
  const status = corrupted ? `(corrupted → ${inferredStatus})` : record.status || '(missing)';
  const hasPdf = Boolean(record.certificatePdfUrl?.trim());
  const hasCertNumber = Boolean(
    record.certificateNumber?.trim() && !isCorruptedFirestoreString(record.certificateNumber),
  );
  const validStatus = ['draft', 'submitted', 'approved', 'certified'].includes(record.status ?? '');

  if (corrupted) {
    notes.push(
      'Firestore status/timestamp fields were corrupted by a worker bug (Dictionary serialized as text).',
    );
  }

  let expectedPhase: PipelineRepairDiagnosis['expectedPhase'] = 'unknown';
  if (hasPdf && hasCertNumber && inferredStatus === 'certified') {
    expectedPhase = 'complete';
  } else if (inferredStatus === 'submitted' || inferredStatus === 'approved') {
    expectedPhase = 'pending';
  }

  let queueEligible = inferredStatus === 'submitted';
  if (corrupted) {
    queueEligible = false;
  }
  if (inferredStatus === 'approved') {
    notes.push(
      'Approved is a legacy mid-state. Reset to submitted so the eMAAP worker can fill & certify.',
    );
  }
  if (inferredStatus === 'certified' && !hasPdf) {
    notes.push('Certified in Firebase but PDF missing — reset to submitted to re-run eMAAP.');
    queueEligible = false;
  }
  if (corrupted && inferredStatus === 'certified' && !hasCertNumber) {
    notes.push('Certificate number field is corrupted or missing — repair clears it; re-run eMAAP if needed.');
  }

  let repairAction: PipelineRepairDiagnosis['repairAction'] = 'none';
  if (corrupted && inferredStatus === 'certified' && hasPdf && hasCertNumber) {
    repairAction = 'fix_certified';
    notes.push('Repair writes valid certified status and timestamps.');
    expectedPhase = 'complete';
  } else if (
    corrupted
    || inferredStatus === 'approved'
    || (inferredStatus === 'certified' && (!hasPdf || !hasCertNumber))
    || (!validStatus && !corrupted)
  ) {
    repairAction = 'set_submitted';
    notes.push('Repair restores status to submitted so the eMAAP worker can process the job.');
    expectedPhase = 'pending';
  } else if (corrupted && inferredStatus === 'submitted') {
    repairAction = 'set_submitted';
    notes.push('Repair will restore status to submitted so the worker can continue.');
    expectedPhase = 'pending';
  }

  return {
    recordId: record.id,
    serialNumber: record.serialNumber,
    status,
    isCorrupted: corrupted,
    expectedPhase,
    queueEligible,
    repairAction,
    notes,
  };
}

export async function findVerificationBySerial(serialNumber: string): Promise<SiteCalibration[]> {
  const trimmed = serialNumber.trim();
  if (!trimmed) {
    return [];
  }

  const snapshot = await getDocs(
    query(collection(db, 'siteCalibrations'), where('serialNumber', '==', trimmed)),
  );

  return snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<SiteCalibration, 'id'>),
  }));
}

export async function repairVerificationCertified(
  recordId: string,
  record?: Pick<
    SiteCalibration,
    'certificateNumber' | 'approvedAt' | 'updatedAt' | 'certifiedAt' | 'submittedAt'
  >,
): Promise<void> {
  const now = new Date().toISOString();
  const submittedAt = isValidVerificationIsoTimestamp(record?.submittedAt) ? record!.submittedAt! : now;
  const approvedAt = isValidVerificationIsoTimestamp(record?.approvedAt) ? record!.approvedAt! : submittedAt;
  const certifiedAt = isValidVerificationIsoTimestamp(record?.certifiedAt) ? record!.certifiedAt! : now;

  await updateDoc(doc(db, 'siteCalibrations', recordId), {
    ...(record ? corruptedFieldCleanupPatch(record) : {}),
    status: 'certified' satisfies VerificationRequestStatus,
    submittedAt,
    approvedAt,
    certifiedAt,
    updatedAt: now,
    pipelineFailedPhase: deleteField(),
    pipelineFailureMessage: deleteField(),
    pipelineFailedAt: deleteField(),
  });
}

export async function repairVerificationSubmitted(
  recordId: string,
  submittedAt?: string,
  record?: Pick<SiteCalibration, 'certificateNumber' | 'approvedAt' | 'updatedAt' | 'certifiedAt' | 'submittedAt'>,
): Promise<void> {
  const now = new Date().toISOString();
  const resolvedSubmittedAt = isValidVerificationIsoTimestamp(submittedAt) ? submittedAt : now;
  await updateDoc(doc(db, 'siteCalibrations', recordId), {
    ...(record ? corruptedFieldCleanupPatch(record) : {}),
    status: 'submitted' satisfies VerificationRequestStatus,
    submittedAt: resolvedSubmittedAt,
    updatedAt: now,
    approvedAt: deleteField(),
    certifiedAt: deleteField(),
    certificatePdfUrl: deleteField(),
    certificateNumber: deleteField(),
    emaapCertificatePdfUrl: deleteField(),
    pipelineFailedPhase: deleteField(),
    pipelineFailureMessage: deleteField(),
    pipelineFailedAt: deleteField(),
  });
}

/** Super Admin only — failed-at-submit → draft so RC/VCT can fix and resubmit. */
export function canMoveFailedSubmitToDraft(
  record: SiteCalibration,
  isSuperAdmin: boolean,
): boolean {
  return isSuperAdmin && isVerificationFailedAtSubmit(record);
}

/**
 * Reverts a failed-at-submit record to draft.
 * Keeps applicationNumber and evidence fields; clears submit/pipeline failure markers.
 */
export async function moveFailedSubmitVerificationToDraft(recordId: string): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'siteCalibrations', recordId), {
    status: 'draft' satisfies VerificationRequestStatus,
    updatedAt: now,
    submittedAt: deleteField(),
    approvedAt: deleteField(),
    certifiedAt: deleteField(),
    pipelineFailedPhase: deleteField(),
    pipelineFailureMessage: deleteField(),
    pipelineFailedAt: deleteField(),
    certificationLastError: deleteField(),
  });
}
