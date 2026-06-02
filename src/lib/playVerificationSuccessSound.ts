let audioContext: AudioContext | null = null;

export function unlockVerificationSuccessAudio(): void {
  if (typeof window === 'undefined') return;

  try {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = new AudioCtx();
    }
    if (audioContext.state === 'suspended') {
      void audioContext.resume();
    }
  } catch {
    // Ignore — autoplay policies or unsupported environments.
  }
}

export function playVerificationSuccessSound(): void {
  if (typeof window === 'undefined') return;

  unlockVerificationSuccessAudio();
  if (!audioContext) return;

  const ctx = audioContext;
  const now = ctx.currentTime;

  const playTone = (frequency: number, start: number, duration: number, gainValue: number) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  };

  try {
    playTone(523.25, now, 0.22, 0.12);
    playTone(659.25, now + 0.12, 0.24, 0.11);
    playTone(783.99, now + 0.24, 0.34, 0.1);
  } catch {
    // Ignore playback errors.
  }
}
