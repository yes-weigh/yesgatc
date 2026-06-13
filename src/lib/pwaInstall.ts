import { isPwaStandalone } from './imageCapture';

export const PWA_INSTALL_AVAILABLE_EVENT = 'yeslab-pwa-install-available';
export const PWA_INSTALL_DISMISSED_KEY = 'yeslab-pwa-install-dismissed-at';
const DISMISS_DAYS = 14;

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let listenersBound = false;

function readEarlyDeferredPrompt(): BeforeInstallPromptEvent | null {
  const win = window as Window & { __YESLAB_DEFERRED_INSTALL__?: BeforeInstallPromptEvent };
  const early = win.__YESLAB_DEFERRED_INSTALL__;
  if (early) {
    delete win.__YESLAB_DEFERRED_INSTALL__;
    return early;
  }
  return null;
}

export function isAndroidChrome(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /Chrome/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
}

export function canShowPwaInstallUi(): boolean {
  if (typeof window === 'undefined') return false;
  if (isPwaStandalone()) return false;
  if (isInstallDismissed()) return false;
  return true;
}

export function isInstallDismissed(): boolean {
  try {
    const raw = localStorage.getItem(PWA_INSTALL_DISMISSED_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    const ms = DISMISS_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < ms;
  } catch {
    return false;
  }
}

export function dismissPwaInstallPrompt(): void {
  try {
    localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  deferredInstallPrompt = null;
}

export function hasDeferredInstallPrompt(): boolean {
  return deferredInstallPrompt != null;
}

export function bindPwaInstallListeners(): void {
  if (typeof window === 'undefined') return;

  const early = readEarlyDeferredPrompt();
  if (early) deferredInstallPrompt = early;

  if (listenersBound) return;
  listenersBound = true;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(PWA_INSTALL_AVAILABLE_EVENT));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    dismissPwaInstallPrompt();
  });
}

export async function triggerPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredInstallPrompt;
  if (!prompt) return 'unavailable';
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  deferredInstallPrompt = null;
  if (outcome === 'accepted') dismissPwaInstallPrompt();
  return outcome;
}
