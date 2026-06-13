import { isMobileTouchDevice, isPwaStandalone } from './imageCapture';

export const PWA_INSTALL_AVAILABLE_EVENT = 'yeslab-pwa-install-available';
export const PWA_INSTALL_DISMISSED_KEY = 'yeslab-pwa-install-dismissed-at';
export const CHROME_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.android.chrome';

const DISMISS_DAYS = 14;

export type AndroidInstallBrowser =
  | 'chrome'
  | 'samsung'
  | 'edge'
  | 'firefox'
  | 'in_app'
  | 'other';

export type PwaInstallPrimaryAction = 'open_chrome' | 'copy_link' | 'reload';

export type PwaInstallGuidance = {
  browser: AndroidInstallBrowser | null;
  title: string;
  description: string;
  primaryLabel: string;
  primaryAction: PwaInstallPrimaryAction;
};

let installPromptSeen = false;
let listenersBound = false;

export function isAndroidPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent) && isMobileTouchDevice();
}

export function isAndroidChrome(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua) && /Chrome/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
}

export function detectAndroidInstallBrowser(): AndroidInstallBrowser | null {
  if (!isAndroidPhone()) return null;
  const ua = navigator.userAgent;
  if (
    /Instagram|FBAN|FBAV|Line\/|MicroMessenger|Twitter|LinkedInApp|Snapchat|WhatsApp|Telegram/i.test(
      ua,
    )
  ) {
    return 'in_app';
  }
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/EdgA/i.test(ua)) return 'edge';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Chrome/i.test(ua)) return 'chrome';
  return 'other';
}

export function canShowPwaInstallUi(): boolean {
  if (typeof window === 'undefined') return false;
  if (isPwaStandalone()) return false;
  if (isInstallDismissed()) return false;
  return true;
}

export function shouldShowMobileInstallBanner(): boolean {
  return canShowPwaInstallUi() && isAndroidPhone();
}

export function hasSeenInstallPrompt(): boolean {
  return installPromptSeen;
}

export function getPwaInstallGuidance(): PwaInstallGuidance {
  const browser = detectAndroidInstallBrowser();

  if (browser === 'in_app') {
    return {
      browser,
      title: 'Open in Chrome first',
      description:
        'Links opened inside WhatsApp or Facebook cannot install apps. Open this page in Chrome, then install from Chrome.',
      primaryLabel: 'Open in Chrome',
      primaryAction: 'open_chrome',
    };
  }

  if (browser === 'firefox' || browser === 'other') {
    return {
      browser,
      title: 'Use Google Chrome',
      description:
        'Install only works in Chrome on Android. Open this page in Chrome, stay signed in for 30 seconds, then check the menu.',
      primaryLabel: 'Open in Chrome',
      primaryAction: 'open_chrome',
    };
  }

  if (browser === 'samsung') {
    return {
      browser,
      title: 'Install YES LAB',
      description:
        'Try Chrome menu (⋮) → Install app. On Samsung Internet: menu → Add page to → Home screen. If missing, open in Chrome.',
      primaryLabel: 'Open in Chrome',
      primaryAction: 'open_chrome',
    };
  }

  if (browser === 'edge') {
    return {
      browser,
      title: 'Install YES LAB',
      description:
        'Edge menu → Add to phone → Install. If missing, open in Chrome and use ⋮ → Install app.',
      primaryLabel: 'Open in Chrome',
      primaryAction: 'open_chrome',
    };
  }

  return {
    browser: 'chrome',
    title: installPromptSeen ? 'Chrome can install this app' : 'Install from Chrome menu',
    description: installPromptSeen
      ? 'Tap ⋮ (top right) → Install app or Add to Home screen.'
      : 'Stay on this page ~30 seconds while signed in. Then tap ⋮ → Install app. If still missing, reload once.',
    primaryLabel: 'Reload page',
    primaryAction: 'reload',
  };
}

export async function getPwaInstallBlockers(): Promise<string[]> {
  if (typeof window === 'undefined') return ['Open this site in the browser'];

  const blockers: string[] = [];

  if (!window.isSecureContext) {
    blockers.push('Use HTTPS (not a plain HTTP link)');
  }

  if (!('serviceWorker' in navigator)) {
    blockers.push('This browser does not support installable apps');
    return blockers;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    blockers.push('App worker not ready — reload the page and wait a few seconds');
  } else if (!navigator.serviceWorker.controller) {
    blockers.push('Reload once so the app worker becomes active');
  }

  if (!document.querySelector('link[rel="manifest"]')) {
    blockers.push('App manifest missing from this page');
  }

  if (detectAndroidInstallBrowser() === 'in_app') {
    blockers.push('Open in Chrome — in-app browsers cannot install');
  }

  return blockers;
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
}

/** Track install availability — do NOT preventDefault (keeps Chrome menu Install option). */
export function bindPwaInstallListeners(): void {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;

  window.addEventListener('beforeinstallprompt', () => {
    installPromptSeen = true;
    window.dispatchEvent(new Event(PWA_INSTALL_AVAILABLE_EVENT));
  });

  window.addEventListener('appinstalled', () => {
    installPromptSeen = false;
    dismissPwaInstallPrompt();
  });
}

export function openCurrentPageInChrome(): void {
  if (typeof window === 'undefined') return;
  const pageUrl = window.location.href;
  const stripped = pageUrl.replace(/^https?:\/\//, '');
  const intent = `intent://${stripped}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(pageUrl)};end`;
  window.location.assign(intent);
}

export async function copyCurrentPageUrl(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch {
    return false;
  }
}

export function reloadForPwaInstall(): void {
  window.location.reload();
}
