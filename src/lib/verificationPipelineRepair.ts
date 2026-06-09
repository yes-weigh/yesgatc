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
import type { SiteCalibration, VerificationRequestStatus } from '../types';

const CORRUPTED_MARKER = 'System.Collections.Generic.Dictionary';

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

export function isCorruptedFirestoreString(value: string | undefined): boolean {
  return Boolean(value?.includes(CORRUPTED_MARKER));
}

export function isCorruptedVerificationRecord(
  record: Pick<SiteCalibration, 'status' | 'approvedAt' | 'updatedAt'>,
): boolean {
  return (
    isCorruptedFirestoreString(record.status) ||
    isCorruptedFirestoreString(record.approvedAt) ||
    isCorruptedFirestoreString(record.updatedAt)
  );
}

export function diagnoseVerificationPipeline(record: SiteCalibration): PipelineRepairDiagnosis {
  const notes: string[] = [];
  const status = record.status ?? '';
  const corrupted = isCorruptedVerificationRecord(record);
  const hasPdf = Boolean(record.certificatePdfUrl?.trim());
  const hasCertNumber = Boolean(record.certificateNumber?.trim());
  const validStatus = ['draft', 'submitted', 'approved', 'certified'].includes(status);

  if (corrupted) {
    notes.push(
      'Firestore status/timestamp fields were corrupted by a worker bug (Dictionary serialized as text).',
    );
    notes.push('Repair will set status to approved so Phase 2 can run (DOCA Upload Certificate).');
  }

  let docaExpectedPhase: PipelineRepairDiagnosis['docaExpectedPhase'] = 'unknown';
  if (hasPdf && hasCertNumber && status === 'certified') {
    docaExpectedPhase = 'complete';
  } else if (corrupted || status === 'approved' || (status === 'submitted' && record.approvedAt)) {
    docaExpectedPhase = 'phase2_pending';
  } else if (status === 'submitted') {
    docaExpectedPhase = 'phase1_pending';
  }

  let queueEligible = status === 'submitted' || status === 'approved';
  if (corrupted) {
    queueEligible = false;
  }
  if (status === 'certified' && !hasPdf) {
    notes.push('Certified in Firebase but PDF missing — worker queue ignores this today.');
    queueEligible = false;
  }

  let repairAction: PipelineRepairDiagnosis['repairAction'] = 'none';
  if (corrupted || (docaExpectedPhase === 'phase2_pending' && status !== 'approved')) {
    repairAction = 'set_approved';
  } else if (!validStatus && !corrupted) {
    repairAction = 'set_submitted';
    notes.push('Status value is invalid — repair will reset to submitted.');
  }

  return {
    recordId: record.id,
    serialNumber: record.serialNumber,
    status: corrupted ? '(corrupted)' : status || '(missing)',
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

export async function repairVerificationSubmitted(recordId: string): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, 'siteCalibrations', recordId), {
    status: 'submitted' satisfies VerificationRequestStatus,
    updatedAt: now,
    approvedAt: deleteField(),
    pipelineFailedPhase: deleteField(),
    pipelineFailureMessage: deleteField(),
    pipelineFailedAt: deleteField(),
  });
}
