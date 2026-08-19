import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/useAuth';
import {
  subscribeAutomationWorkerLogs,
  subscribeAutomationWorkerStatus,
  type AutomationWorkerLogEntry,
  type AutomationWorkerStatus,
} from '../lib/automationWorker';
import { buildCertificateHoldNotes } from '../lib/verificationCertificateHoldNotes';
import {
  isVerificationFullyCertified,
  normalizeVerificationStatus,
} from '../lib/verificationRequest';
import type { SiteCalibration } from '../types';

type VerificationCertificateNotesBoxProps = {
  record: SiteCalibration;
};

export const VerificationCertificateNotesBox: React.FC<VerificationCertificateNotesBoxProps> = ({
  record,
}) => {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const [worker, setWorker] = useState<AutomationWorkerStatus | null>(null);
  const [logs, setLogs] = useState<AutomationWorkerLogEntry[]>([]);

  useEffect(() => {
    if (!isSuper) return undefined;
    const stopStatus = subscribeAutomationWorkerStatus(setWorker, () => undefined);
    const stopLogs = subscribeAutomationWorkerLogs(setLogs, () => undefined, 80);
    return () => {
      stopStatus();
      stopLogs();
    };
  }, [isSuper, record.id]);

  const notes = useMemo(() => {
    const status = normalizeVerificationStatus(record);
    if (status === 'draft') {
      return {
        title: 'Not submitted',
        body: 'This record is still a draft. Submit it for certification before eMAAP can issue a certificate.',
      };
    }
    return buildCertificateHoldNotes(record, isSuper ? worker : null, isSuper ? logs : []);
  }, [isSuper, logs, record, worker]);

  if (isVerificationFullyCertified(record)) return null;

  return (
    <div className="verification-cert-notes" role="note">
      <p className="verification-cert-notes__label">Notes</p>
      <h4 className="verification-cert-notes__title">{notes.title}</h4>
      <p className="verification-cert-notes__body">{notes.body}</p>
      {'logLine' in notes && notes.logLine ? (
        <p className="verification-cert-notes__log">Worker log: {notes.logLine}</p>
      ) : null}
    </div>
  );
};
