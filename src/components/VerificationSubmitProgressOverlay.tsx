import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { QRCode } from 'react-qr-code';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileCheck,
  FileText,
  MapPin,
  Scale,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { db } from '../firebase';
import { buildDocaCertificateViewUrl } from '../lib/docaCertificateUrl';
import { playVerificationSuccessSound } from '../lib/playVerificationSuccessSound';
import {
  buildVerificationSubmitProgressDetails,
  verificationSubmitProgressFooterMessage,
  type VerificationProgressDetailRow,
} from '../lib/verificationSubmitProgressDetails';
import {
  VERIFICATION_SUBMIT_PROGRESS_STAGES,
  resolveVerificationSubmitProgressStage,
  verificationSubmitProgressStageIndex,
  type VerificationSubmitProgressStage,
} from '../lib/verificationSubmitProgressStages';
import { VerificationSubmitProgressCountdown } from './VerificationSubmitProgressCountdown';
import type { Customer, SiteCalibration } from '../types';

type VerificationSubmitProgressOverlayProps = {
  recordIds: string[];
  onClose: () => void;
};

function stageIcon(stage: VerificationSubmitProgressStage) {
  switch (stage) {
    case 'submitted':
      return FileText;
    case 'approved':
      return FileCheck;
    case 'certified':
      return ShieldCheck;
  }
}

function detailRowIcon(rowId: string) {
  switch (rowId) {
    case 'application':
    case 'certificate':
      return FileText;
    case 'instrument':
    case 'capacity':
      return Scale;
    case 'customer':
    case 'client':
      return UserRound;
    case 'location':
      return MapPin;
    case 'submitted-date':
    case 'verified-on':
      return Calendar;
    case 'submitted-time':
    case 'approved-on':
      return Clock3;
    case 'valid-upto':
      return CalendarClock;
    default:
      return FileText;
  }
}

function VerificationProgressQr({ certificateNumber }: { certificateNumber?: string | null }) {
  const url = useMemo(() => buildDocaCertificateViewUrl(certificateNumber), [certificateNumber]);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="verification-submit-progress-qr"
      aria-label={`View DOCA certificate ${certificateNumber?.trim()}`}
    >
      <QRCode
        value={url}
        size={108}
        bgColor="#ffffff"
        fgColor="#0f172a"
        level="M"
        aria-hidden
      />
    </a>
  );
}

function VerificationProgressDetails({
  rows,
}: {
  rows: VerificationProgressDetailRow[];
}) {
  return (
    <dl className="verification-submit-progress-details">
      {rows.map(row => {
        const Icon = detailRowIcon(row.id);
        return (
          <div key={row.id} className="verification-submit-progress-detail-row">
            <dt className="verification-submit-progress-detail-label">
              <Icon size={15} aria-hidden />
              <span>{row.label}</span>
            </dt>
            <dd className="verification-submit-progress-detail-value">{row.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export const VerificationSubmitProgressOverlay: React.FC<
  VerificationSubmitProgressOverlayProps
> = ({ recordIds, onClose }) => {
  const [recordsById, setRecordsById] = useState<Record<string, SiteCalibration>>({});
  const [customersById, setCustomersById] = useState<Record<string, Customer>>({});
  const [visible, setVisible] = useState(false);
  const [stagePulse, setStagePulse] = useState(false);
  const previousStageRef = useRef<VerificationSubmitProgressStage>('submitted');
  const successSoundPlayedRef = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!recordIds.length) return;

    const unsubs = recordIds.map(recordId =>
      onSnapshot(doc(db, 'siteCalibrations', recordId), snapshot => {
        if (!snapshot.exists()) return;
        setRecordsById(prev => ({
          ...prev,
          [recordId]: { id: snapshot.id, ...(snapshot.data() as Omit<SiteCalibration, 'id'>) },
        }));
      }),
    );

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [recordIds]);

  const trackedRecords = useMemo(
    () => recordIds.map(id => recordsById[id]).filter(Boolean) as SiteCalibration[],
    [recordIds, recordsById],
  );

  const primaryRecord = trackedRecords[0] ?? null;

  useEffect(() => {
    const customerIds = [...new Set(trackedRecords.map(record => record.customerId).filter(Boolean))];
    if (!customerIds.length) return;

    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        customerIds.map(async customerId => {
          try {
            const snap = await getDoc(doc(db, 'customers', customerId));
            if (!snap.exists()) return null;
            return [customerId, { id: snap.id, ...(snap.data() as Omit<Customer, 'id'>) }] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) return;

      setCustomersById(prev => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [trackedRecords]);

  const stage = resolveVerificationSubmitProgressStage(trackedRecords);
  const stageIndex = verificationSubmitProgressStageIndex(stage);
  const stageMeta = VERIFICATION_SUBMIT_PROGRESS_STAGES[stageIndex];
  const StageIcon = stageIcon(stage);
  const waitingForServer = trackedRecords.length < recordIds.length;
  const customer = primaryRecord ? customersById[primaryRecord.customerId] : undefined;
  const detailRows = primaryRecord
    ? buildVerificationSubmitProgressDetails(stage, primaryRecord, customer)
    : [];
  const footerMessage = verificationSubmitProgressFooterMessage(stage);
  const extraRecordCount = Math.max(0, recordIds.length - 1);

  useEffect(() => {
    if (previousStageRef.current === stage) return;
    previousStageRef.current = stage;
    setStagePulse(true);
    const timer = window.setTimeout(() => setStagePulse(false), 900);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'certified' || successSoundPlayedRef.current) return;
    successSoundPlayedRef.current = true;
    playVerificationSuccessSound();
  }, [stage]);

  const waitingMessage = waitingForServer ? 'Syncing submission status…' : null;

  return createPortal(
    <div
      className={`verification-submit-progress-root${visible ? ' verification-submit-progress-root--visible' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-submit-progress-title"
    >
      <div className="verification-submit-progress-backdrop" aria-hidden />
      <div
        className={`verification-submit-progress-card verification-submit-progress-card--${stage}${
          stagePulse ? ' verification-submit-progress-card--pulse' : ''
        }`}
      >
        <div className="verification-submit-progress-visual" aria-hidden>
          {stage === 'certified' && (
            <div className="verification-submit-progress-confetti">
              {Array.from({ length: 18 }, (_, index) => (
                <span key={index} className={`verification-submit-progress-confetti-piece piece-${index % 6}`} />
              ))}
            </div>
          )}
          <div className="verification-submit-progress-glow" />
          <div className="verification-submit-progress-icon-wrap">
            <StageIcon size={42} strokeWidth={1.6} />
            <span className="verification-submit-progress-icon-badge">
              <CheckCircle2 size={18} />
            </span>
          </div>
        </div>

        <h2 id="verification-submit-progress-title" className="verification-submit-progress-title">
          {stageMeta.title}
        </h2>
        <p className="verification-submit-progress-message">{stageMeta.message}</p>

        {!waitingForServer && stage !== 'certified' && (
          <VerificationSubmitProgressCountdown stage={stage} />
        )}

        {extraRecordCount > 0 && (
          <p className="verification-submit-progress-multi mb-0">
            Showing details for 1 of {recordIds.length} verifications.
          </p>
        )}

        {detailRows.length > 0 && (
          <VerificationProgressDetails rows={detailRows} />
        )}

        {stage === 'certified' && (
          <div className="verification-submit-progress-certified-footer">
            {footerMessage && (
              <p className="verification-submit-progress-success-label mb-0">{footerMessage}</p>
            )}
            <VerificationProgressQr certificateNumber={primaryRecord?.certificateNumber} />
            <p className="verification-submit-progress-signatory mb-0">Authorised Signatory</p>
          </div>
        )}

        {footerMessage && stage === 'submitted' && (
          <p className="verification-submit-progress-footer-note mb-0">{footerMessage}</p>
        )}

        {(waitingForServer || waitingMessage) && stage !== 'certified' && (
          <p className="verification-submit-progress-waiting mb-0" role="status">
            {waitingMessage}
          </p>
        )}

        {stage === 'certified' ? (
          <button
            type="button"
            className="btn btn-primary verification-submit-progress-done"
            onClick={onClose}
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary verification-submit-progress-done"
            onClick={onClose}
          >
            Continue in background
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
};
