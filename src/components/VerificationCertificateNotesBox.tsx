import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/useAuth';
import {
  subscribeAutomationWorkerLogs,
  subscribeAutomationWorkerStatus,
  type AutomationWorkerLogEntry,
  type AutomationWorkerStatus,
} from '../lib/automationWorker';
import {
  buildCertificateHoldNotes,
  shouldShowCertificateHoldNotes,
} from '../lib/verificationCertificateHoldNotes';
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
    if (!isSuper || !shouldShowCertificateHoldNotes(record)) return;
    const stopStatus = subscribeAutomationWorkerStatus(setWorker);
    const stopLogs = subscribeAutomationWorkerLogs(setLogs, undefined, 80);
    return () => {
      stopStatus();
      stopLogs();
    };
  }, [isSuper, record.id]);

  const notes = useMemo(
    () =>
      shouldShowCertificateHoldNotes(record)
        ? buildCertificateHoldNotes(record, isSuper ? worker : null, isSuper ? logs : [])
        : null,
    [isSuper, logs, record, worker],
  );

  if (!notes) return null;

  return (
    <aside className="verification-cert-notes" aria-label="Certificate notes">
      <p className="verification-cert-notes__label">Notes</p>
      <h4 className="verification-cert-notes__title">{notes.title}</h4>
      <p className="verification-cert-notes__body">{notes.body}</p>
      {notes.logLine ? (
        <p className="verification-cert-notes__log">
          Worker log: {notes.logLine}
        </p>
      ) : null}
    </aside>
  );
};
