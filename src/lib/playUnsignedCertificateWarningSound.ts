let audioContext: AudioContext | null = null;
let playedThisSession = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioContext) {
      const AudioCtx =
        window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      audioContext = new AudioCtx();
    }
    if (audioContext.state === 'suspended') {
      void audioContext.resume();
    }
    return audioContext;
  } catch {
    return null;
  }
}

export function unlockUnsignedCertificateWarningAudio(): void {
  getAudioContext();
}

/** Short descending alert — signed PDF backlog warning. */
export function playUnsignedCertificateWarningSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const playTone = (
    frequency: number,
    start: number,
    duration: number,
    gainValue: number,
    type: OscillatorType = 'square',
  ) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
  };

  try {
    playTone(880, now, 0.16, 0.12);
    playTone(660, now + 0.18, 0.18, 0.11);
    playTone(880, now + 0.4, 0.16, 0.12);
    playTone(523.25, now + 0.58, 0.28, 0.1);
  } catch {
    // Ignore playback errors (autoplay policy, etc.).
  }
}

/** Always play (user gesture / mock preview). */
export function playUnsignedCertificateWarningNow(): void {
  unlockUnsignedCertificateWarningAudio();
  playUnsignedCertificateWarningSound();
}

/** Play once per tab session when RC has unsigned cert backlog. */
export function playUnsignedCertificateWarningOnce(): void {
  if (typeof window === 'undefined') return;
  if (playedThisSession) return;
  playedThisSession = true;

  const tryPlay = () => {
    playUnsignedCertificateWarningNow();
  };

  tryPlay();

  const ctx = audioContext;
  if (ctx && ctx.state === 'suspended') {
    const onGesture = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      tryPlay();
    };
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
  }
}

export function resetUnsignedCertificateWarningSession(): void {
  playedThisSession = false;
}
