import type { SiteCalibration } from '../types';
import {
  isVerificationFullyCertified,
  normalizeVerificationStatus,
} from './verificationRequest';

export type VerificationSubmitProgressStage = 'submitted' | 'approved' | 'certified';

export const VERIFICATION_SUBMIT_PROGRESS_STAGES: {
  id: VerificationSubmitProgressStage;
  title: string;
  message: string;
  shortLabel: string;
}[] = [
  {
    id: 'submitted',
    title: 'Application submitted',
    message: 'Your application has been submitted successfully.',
    shortLabel: 'Submitted',
  },
  {
    id: 'approved',
    title: 'Application approved',
    message: 'Your application has been approved. You can proceed to verification.',
    shortLabel: 'Approved',
  },
  {
    id: 'certified',
    title: 'Verification certified',
    message: 'Your instrument has been verified successfully.',
    shortLabel: 'Certified',
  },
];

export function resolveVerificationSubmitProgressStage(
  records: SiteCalibration[],
): VerificationSubmitProgressStage {
  if (records.length === 0) return 'submitted';

  const statuses = records.map(record => normalizeVerificationStatus(record));
  const allCertified = records.every(
    record =>
      isVerificationFullyCertified(record) ||
      Boolean(record.certificatePdfUrl?.trim()) ||
      normalizeVerificationStatus(record) === 'certified',
  );
  if (allCertified) return 'certified';

  const allApprovedOrBeyond = statuses.every(
    status => status === 'approved' || status === 'certified',
  );
  if (allApprovedOrBeyond) return 'approved';

  return 'submitted';
}

export function verificationSubmitProgressStageIndex(
  stage: VerificationSubmitProgressStage,
): number {
  return VERIFICATION_SUBMIT_PROGRESS_STAGES.findIndex(item => item.id === stage);
}
