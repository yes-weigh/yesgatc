import type { VerificationSubmitProgressStage } from './verificationSubmitProgressStages';

/** Typical approval time from submit (certificate worker). */
export const VERIFICATION_PROGRESS_APPROVAL_ETA_SECONDS = 35;

/** Typical certification time after approval. */
export const VERIFICATION_PROGRESS_CERTIFICATION_ETA_SECONDS = 60;

/** Typical end-to-end verification pipeline duration. */
export const VERIFICATION_PROGRESS_TOTAL_ETA_SECONDS = 100;

export function verificationProgressEtaSeconds(
  stage: VerificationSubmitProgressStage,
): number | null {
  if (stage === 'submitted') return VERIFICATION_PROGRESS_APPROVAL_ETA_SECONDS;
  if (stage === 'approved') return VERIFICATION_PROGRESS_CERTIFICATION_ETA_SECONDS;
  return null;
}

export function verificationProgressCountdownMessage(
  stage: VerificationSubmitProgressStage,
  secondsLeft: number,
): string {
  if (stage === 'submitted') {
    if (secondsLeft <= 0) return 'Approval landing any moment now…';
    return `Your application will be approved in ${formatCountdownSeconds(secondsLeft)}`;
  }

  if (stage === 'approved') {
    if (secondsLeft <= 0) return 'Your certificate is almost ready…';
    return `Your certificate will be ready in ${formatCountdownSeconds(secondsLeft)}`;
  }

  return '';
}

export function formatCountdownSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (remainder === 0) {
      return `${minutes} min`;
    }
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export function verificationProgressCountdownProgress(
  stage: VerificationSubmitProgressStage,
  secondsLeft: number,
): number {
  const eta = verificationProgressEtaSeconds(stage);
  if (!eta) return 1;
  return Math.max(0, Math.min(1, 1 - secondsLeft / eta));
}
