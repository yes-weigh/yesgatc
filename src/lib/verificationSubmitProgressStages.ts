import type { SiteCalibration } from '../types';
import {
  isVerificationFullyCertified,
  normalizeVerificationStatus,
} from './verificationRequest';

/** RC progress after submit: Submitted → Certified (eMAAP worker, one pass). */
export type VerificationSubmitProgressStage = 'submitted' | 'certified';

export const VERIFICATION_SUBMIT_PROGRESS_STAGES: {
  id: VerificationSubmitProgressStage;
  title: string;
  message: string;
  shortLabel: string;
}[] = [
  {
    id: 'submitted',
    title: 'Application submitted',
    message: 'Your application is with the certificate worker for eMAAP processing.',
    shortLabel: 'Submitted',
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

  const allCertified = records.every(
    record =>
      isVerificationFullyCertified(record) ||
      Boolean(record.certificatePdfUrl?.trim()) ||
      normalizeVerificationStatus(record) === 'certified',
  );
  if (allCertified) return 'certified';

  return 'submitted';
}

export function verificationSubmitProgressStageIndex(
  stage: VerificationSubmitProgressStage,
): number {
  return VERIFICATION_SUBMIT_PROGRESS_STAGES.findIndex(item => item.id === stage);
}
