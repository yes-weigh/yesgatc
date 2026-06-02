import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { CheckCircle2, FileCheck, FileText, ShieldCheck } from 'lucide-react';
import { db } from '../firebase';
import { playVerificationSuccessSound } from '../lib/playVerificationSuccessSound';
import {
  VERIFICATION_SUBMIT_PROGRESS_STAGES,
  resolveVerificationSubmitProgressStage,
  verificationSubmitProgressStageIndex,
  type VerificationSubmitProgressStage,
} from '../lib/verificationSubmitProgressStages';
import type { SiteCalibration } from '../types';

type VerificationSubmitProgressOverlayProps = {
  recordIds: string[];
  onClose: () => void;
  /** TEMP — remove when certificate worker testing is no longer needed. */
  simulate?: boolean;
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

export const VerificationSubmitProgressOverlay: React.FC<
  VerificationSubmitProgressOverlayProps
> = ({ recordIds, onClose, simulate = false }) => {
  const [recordsById, setRecordsById] = useState<Record<string, SiteCalibration>>({});
  const [simulatedStage, setSimulatedStage] = useState<VerificationSubmitProgressStage>('submitted');
  const [visible, setVisible] = useState(false);
  const [stagePulse, setStagePulse] = useState(false);
  const previousStageRef = useRef<VerificationSubmitProgressStage>('submitted');
  const successSoundPlayedRef = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (simulate) return;
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
  }, [recordIds, simulate]);

  useEffect(() => {
    if (!simulate) return;
    setSimulatedStage('submitted');
    successSoundPlayedRef.current = false;
    previousStageRef.current = 'submitted';

    const approvedTimer = window.setTimeout(() => setSimulatedStage('approved'), 2400);
    const certifiedTimer = window.setTimeout(() => setSimulatedStage('certified'), 5200);

    return () => {
      window.clearTimeout(approvedTimer);
      window.clearTimeout(certifiedTimer);
    };
  }, [simulate]);

  const trackedRecords = useMemo(
    () => recordIds.map(id => recordsById[id]).filter(Boolean) as SiteCalibration[],
    [recordIds, recordsById],
  );

  const firestoreStage = resolveVerificationSubmitProgressStage(trackedRecords);
  const stage = simulate ? simulatedStage : firestoreStage;
  const stageIndex = verificationSubmitProgressStageIndex(stage);
  const stageMeta = VERIFICATION_SUBMIT_PROGRESS_STAGES[stageIndex];
  const StageIcon = stageIcon(stage);
  const waitingForServer = !simulate && trackedRecords.length < recordIds.length;

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

  const waitingMessage = simulate
    ? 'Simulating certificate server progress…'
    : stage === 'submitted'
      ? 'Waiting for approval from the certificate server…'
      : stage === 'approved'
        ? 'Generating your certificate…'
        : null;

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
        <ol className="verification-submit-progress-steps" aria-label="Verification progress">
          {VERIFICATION_SUBMIT_PROGRESS_STAGES.map((item, index) => {
            const done = index < stageIndex;
            const active = index === stageIndex;
            return (
              <li
                key={item.id}
                className={`verification-submit-progress-step${
                  done ? ' verification-submit-progress-step--done' : ''
                }${active ? ' verification-submit-progress-step--active' : ''}`}
              >
                <span className="verification-submit-progress-step-dot">
                  {done ? <CheckCircle2 size={14} aria-hidden /> : index + 1}
                </span>
                <span className="verification-submit-progress-step-label">{item.shortLabel}</span>
              </li>
            );
          })}
        </ol>

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
        {simulate && (
          <p className="verification-submit-progress-demo-badge mb-0">Demo preview</p>
        )}
        <p className="verification-submit-progress-message">{stageMeta.message}</p>

        {(waitingForServer || waitingMessage) && stage !== 'certified' && (
          <p className="verification-submit-progress-waiting mb-0" role="status">
            {waitingForServer ? 'Syncing submission status…' : waitingMessage}
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
