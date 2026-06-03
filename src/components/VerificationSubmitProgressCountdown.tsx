import React, { useEffect, useState, type CSSProperties } from 'react';
import {
  verificationProgressCountdownMessage,
  verificationProgressCountdownProgress,
  verificationProgressEtaSeconds,
  VERIFICATION_PROGRESS_TOTAL_ETA_SECONDS,
} from '../lib/verificationSubmitProgressTiming';
import type { VerificationSubmitProgressStage } from '../lib/verificationSubmitProgressStages';

type VerificationSubmitProgressCountdownProps = {
  stage: VerificationSubmitProgressStage;
};

export const VerificationSubmitProgressCountdown: React.FC<
  VerificationSubmitProgressCountdownProps
> = ({ stage }) => {
  const eta = verificationProgressEtaSeconds(stage);
  const [secondsLeft, setSecondsLeft] = useState(eta ?? 0);
  const [tickPulse, setTickPulse] = useState(false);

  useEffect(() => {
    const nextEta = verificationProgressEtaSeconds(stage);
    if (nextEta == null) return;
    setSecondsLeft(nextEta);
  }, [stage]);

  useEffect(() => {
    if (eta == null) return;

    const interval = window.setInterval(() => {
      setSecondsLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [stage, eta]);

  useEffect(() => {
    if (eta == null) return;
    setTickPulse(true);
    const timer = window.setTimeout(() => setTickPulse(false), 320);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, eta]);

  if (eta == null) return null;

  const progress = verificationProgressCountdownProgress(stage, secondsLeft);
  const message = verificationProgressCountdownMessage(stage, secondsLeft);
  const displaySeconds = Math.max(secondsLeft, 0);
  const urgent = displaySeconds > 0 && displaySeconds <= 5;
  const almostThere = displaySeconds <= 0;

  return (
    <div
      className={`verification-submit-progress-countdown verification-submit-progress-countdown--${stage}${
        urgent ? ' verification-submit-progress-countdown--urgent' : ''
      }${almostThere ? ' verification-submit-progress-countdown--almost' : ''}${
        tickPulse ? ' verification-submit-progress-countdown--tick' : ''
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="verification-submit-progress-countdown-ring"
        style={{ '--countdown-progress': String(progress) } as CSSProperties}
      >
        <span className="verification-submit-progress-countdown-value">{displaySeconds}</span>
      </div>

      <p className="verification-submit-progress-countdown-label mb-0">{message}</p>

      <div className="verification-submit-progress-countdown-track" aria-hidden>
        <span
          className="verification-submit-progress-countdown-fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <p className="verification-submit-progress-countdown-hint mb-0">
        Typical full verification ~{Math.floor(VERIFICATION_PROGRESS_TOTAL_ETA_SECONDS / 60)} min
        {VERIFICATION_PROGRESS_TOTAL_ETA_SECONDS % 60 > 0
          ? ` ${VERIFICATION_PROGRESS_TOTAL_ETA_SECONDS % 60} sec`
          : ''}
      </p>
    </div>
  );
};
