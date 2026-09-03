import { capacityToMalayalam } from './malayalamNumber';

const ML_LANG = 'ml-IN';

function voicesOf(synth: SpeechSynthesis): SpeechSynthesisVoice[] {
  return synth.getVoices();
}

function pickMalayalamVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return (
    voices.find(voice => /^ml-IN/i.test(voice.lang))
    || voices.find(voice => /^ml\b/i.test(voice.lang))
    || voices.find(voice => /malayalam|മലയാളം/i.test(voice.name))
  );
}

function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return (
    voices.find(voice => /^en-IN/i.test(voice.lang))
    || voices.find(voice => /^en/i.test(voice.lang))
    || voices[0]
  );
}

function toEnglishCapacity(label: string): string {
  return label.replace(/\bkg\b/gi, 'kilogram').replace(/\bg\b/gi, 'gram');
}

function queueUtterance(
  synth: SpeechSynthesis,
  text: string,
  lang: string,
  voice: SpeechSynthesisVoice | undefined,
  onFail?: () => void,
): void {
  const spoken = text.replace(/\s+/g, ' ').trim();
  if (!spoken) {
    onFail?.();
    return;
  }
  if (synth.paused) synth.resume();
  if (synth.speaking || synth.pending) synth.cancel();

  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = voice?.lang || lang;
  utterance.rate = lang.startsWith('ml') ? 0.82 : 0.95;
  if (voice) utterance.voice = voice;

  let started = false;
  let finished = false;
  const fail = () => {
    if (finished || started) return;
    finished = true;
    onFail?.();
  };
  utterance.onstart = () => {
    started = true;
  };
  utterance.onerror = fail;
  if (onFail) {
    window.setTimeout(() => {
      if (!started && !synth.speaking && !synth.pending) fail();
    }, 500);
  }

  synth.speak(utterance);
  if (synth.paused) synth.resume();
}

function speakCapacityNow(synth: SpeechSynthesis, label: string): void {
  const voices = voicesOf(synth);
  const malayalamLine = capacityToMalayalam(label);
  const englishLine = toEnglishCapacity(label);
  const mlVoice = pickMalayalamVoice(voices);
  const enVoice = pickEnglishVoice(voices);

  const speakEnglish = () => {
    queueUtterance(synth, englishLine, 'en-IN', enVoice);
  };

  if (malayalamLine && mlVoice) {
    queueUtterance(synth, malayalamLine, ML_LANG, mlVoice, speakEnglish);
    return;
  }
  speakEnglish();
}

/** Must run inside the tap handler — delayed speak is blocked on phone browsers. */
export function speakCapacityChoice(label: string): void {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') return;
  const synth = window.speechSynthesis;
  const trimmed = label.replace(/\s+/g, ' ').trim();
  if (!trimmed) return;
  synth.resume();
  speakCapacityNow(synth, trimmed);
}

if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined') {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices();
  });
}
