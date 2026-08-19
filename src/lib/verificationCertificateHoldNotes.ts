import type { AutomationWorkerLogEntry, AutomationWorkerStatus } from './automationWorker';
import {
  isVerificationFullyCertified,
  normalizeVerificationStatus,
} from './verificationRequest';
import type { SiteCalibration } from '../types';

export type CertificateHoldNotes = {
  title: string;
  body: string;
  logLine?: string;
};

export function shouldShowCertificateHoldNotes(record: SiteCalibration): boolean {
  const status = normalizeVerificationStatus(record);
  if (status === 'draft') return false;
  if (isVerificationFullyCertified(record)) return false;
  return true;
}

export function buildCertificateHoldNotes(
  record: SiteCalibration,
  worker?: AutomationWorkerStatus | null,
  logs: AutomationWorkerLogEntry[] = [],
): CertificateHoldNotes {
  const serial = record.serialNumber?.trim() || 'this instrument';
  const pipeline =
    record.pipelineFailureMessage?.trim() || record.certificationLastError?.trim() || '';
  const matchingLog = logs.find(entry => {
    const msg = entry.message || '';
    return (
      (serial !== 'this instrument' && msg.includes(serial)) ||
      (record.id && msg.includes(record.id))
    );
  });
  const queueLog = logs.find(entry => /ready in pipeline/i.test(entry.message || ''));
  const logLine = matchingLog?.message || queueLog?.message;

  if (pipeline) {
    return {
      title: 'Certificate not issued',
      body: pipeline,
      logLine,
    };
  }

  const status = normalizeVerificationStatus(record);
  if (status === 'rejected') {
    return {
      title: 'Certificate not issued',
      body: pipeline || 'eMAAP rejected this application.',
      logLine,
    };
  }

  const queueHint =
    worker && worker.queueSubmitted > 0 && worker.queueEligible === 0
      ? ` Worker queue: ${worker.queueSubmitted} submitted, ${worker.queueEligible} eligible. Job is locked in the worker retry list (not a photo problem). Restart the certificate worker on the VPS to process ${serial}.`
      : '';

  const neverLogged = !matchingLog
    ? ` No eMAAP worker log names serial ${serial}. The worker never ran fill/certify for this record.`
    : '';

  return {
    title: 'Certificate not issued',
    body: `Application is still submitted. Photos are on the record. eMAAP has not written a certificate number.${neverLogged}${queueHint}`,
    logLine,
  };
}
