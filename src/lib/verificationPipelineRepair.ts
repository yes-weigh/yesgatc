import {
  collection,
  deleteField,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  inferVerificationStatus,
  isCorruptedFirestoreString,
  isCorruptedVerificationRecord,
  isValidVerificationIsoTimestamp,
} from './verificationRequest';
import type { SiteCalibration, VerificationRequestStatus } from '../types';

export type PipelineRepairDiagnosis = {
  recordId: string;
  serialNumber: string;
  status: string;
  isCorrupted: boolean;
  docaExpectedPhase: 'phase1_pending' | 'phase2_pending' | 'complete' | 'unknown';
  queueEligible: boolean;
  repairAction: 'set_approved' | 'set_submitted' | 'none';
  notes: string[];
};

export { isCorruptedFirestoreString, isCorruptedVerificationRecord };

export function diagnoseVerificationPipeline(record: SiteCalibration): PipelineRepairDiagnosis {
  const notes: string[] = [];
  const corrupted = isCorruptedVerificationRecord(record);
  const inferredStatus = inferVerificationStatus(record);
  const status = corrupted ? `(corrupted → ${inferredStatus})` : record.status || '(missing)';
  const hasPdf = Boolean(record.certificatePdfUrl?.trim());
  const hasCertNumber = Boolean(record.certificateNumber?.trim());
  const validStatus = ['draft', 'submitted', 'approved', 'certified'].includes(record.status ?? '');

  if (corrupted) {
    notes.push(
      'Firestore status/timestamp fields were corrupted by a worker bug (Dictionary serialized as text).',
    );
  }

  let docaExpectedPhase: PipelineRepairDiagnosis['docaExpectedPhase'] = 'unknown';
  if (hasPdf && hasCertNumber && inferredStatus === 'certified') {
    docaExpectedPhase = 'complete';
  } else if (inferredStatus === 'approved' || (inferredStatus === 'submitted' && isValidVerificationIsoTimestamp(record.approvedAt))) {
    docaExpectedPhase = 'phase2_pending';
  } else if (inferredStatus === 'submitted') {
    docaExpectedPhase = 'phase1_pending';
  }

  let queueEligible = inferredStatus === 'submitted' || inferredStatus === 'approved';
  if (corrupted) {
    queueEligible = false;
  }
  if (inferredStatus === 'certified' && !hasPdf) {
    notes.push('Certified in Firebase but PDF missing — worker queue ignores this today.');
    queueEligible = false;
  }

  let repairAction: PipelineRepairDiagnosis['repairAction'] = 'none';
  if (corrupted && inferredStatus === 'submitted') {
    repairAction = 'set_submitted';
    notes.push('Repair will restore status to submitted so the worker can continue Phase 1/2.');
  } else if (corrupted && (inferredStatus === 'approved' || docaExpectedPhase === 'phase2_pending')) {
    repairAction = 'set_approved';
    notes.push('Repair will set status to approved so Phase 2 can run (DOCA Upload Certificate).');
  } else if (!validStatus && !corrupted) {
    repairAction = 'set_submitted';
    notes.push('Status value is invalid — repair will reset to submitted.');
  }

  return {
    recordId: record.id,
    serialNumber: record.serialNumber,
    status,
    isCorrupted: corrupted,
    docaExpectedPhase,
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

export async function repairVerificationForPhase2(recordId: string): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'siteCalibrations', recordId), {
    status: 'approved' satisfies VerificationRequestStatus,
    approvedAt: now,
    updatedAt: now,
    pipelineFailedPhase: deleteField(),
    pipelineFailureMessage: deleteField(),
    pipelineFailedAt: deleteField(),
  });
}

export async function repairVerificationSubmitted(recordId: string, submittedAt?: string): Promise<void> {
  const now = new Date().toISOString();
  const resolvedSubmittedAt = isValidVerificationIsoTimestamp(submittedAt) ? submittedAt : now;
  await updateDoc(doc(db, 'siteCalibrations', recordId), {
    status: 'submitted' satisfies VerificationRequestStatus,
    submittedAt: resolvedSubmittedAt,
    updatedAt: now,
    approvedAt: deleteField(),
    pipelineFailedPhase: deleteField(),
    pipelineFailureMessage: deleteField(),
    pipelineFailedAt: deleteField(),
  });
}
