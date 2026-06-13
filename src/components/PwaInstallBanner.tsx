import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, Smartphone, X } from 'lucide-react';
import {
  canShowPwaInstallUi,
  CHROME_PLAY_STORE_URL,
  copyCurrentPageUrl,
  dismissPwaInstallPrompt,
  getPwaInstallBlockers,
  getPwaInstallGuidance,
  hasSeenInstallPrompt,
  openCurrentPageInChrome,
  PWA_INSTALL_AVAILABLE_EVENT,
  reloadForPwaInstall,
  shouldShowMobileInstallBanner,
} from '../lib/pwaInstall';

export const PwaInstallBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installHint, setInstallHint] = useState('');
  const [blockers, setBlockers] = useState<string[]>([]);
  const [promptReady, setPromptReady] = useState(false);

  const refreshBlockers = useCallback(async () => {
    const next = await getPwaInstallBlockers();
    setBlockers(next);
  }, []);

  const refresh = useCallback(() => {
    if (!shouldShowMobileInstallBanner()) {
      setVisible(false);
      return;
    }
    setPromptReady(hasSeenInstallPrompt());
    setVisible(true);
    void refreshBlockers();
  }, [refreshBlockers]);

  const guidance = useMemo(() => getPwaInstallGuidance(), [promptReady, blockers.length]);

  useEffect(() => {
    refresh();
    const onAvailable = () => refresh();
    window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, onAvailable);
    const timer = window.setTimeout(() => void refreshBlockers(), 2500);
    return () => {
      window.removeEventListener(PWA_INSTALL_AVAILABLE_EVENT, onAvailable);
      window.clearTimeout(timer);
    };
  }, [refresh, refreshBlockers]);

  const handlePrimary = async () => {
    setBusy(true);
    setInstallHint('');
    try {
      if (guidance.primaryAction === 'open_chrome') {
        openCurrentPageInChrome();
        setInstallHint('Opening Chrome… If nothing happens, install Chrome from Play Store first.');
        return;
      }

      if (guidance.primaryAction === 'copy_link') {
        const copied = await copyCurrentPageUrl();
        setInstallHint(
          copied
            ? 'Link copied. Paste into Chrome’s address bar.'
            : 'Copy the address bar URL and open it in Chrome.',
        );
        return;
      }

      reloadForPwaInstall();
    } finally {
      setBusy(false);
    }
  };

  const handleCopyLink = async () => {
    const copied = await copyCurrentPageUrl();
    setInstallHint(
      copied
        ? 'Link copied. Paste into Chrome if Open in Chrome did not work.'
        : 'Copy the address bar URL and open it in Chrome.',
    );
  };

  const handleDismiss = () => {
    if (!canShowPwaInstallUi()) return;
    dismissPwaInstallPrompt();
    setVisible(false);
  };

  if (!visible) return null;

  const PrimaryIcon =
    guidance.primaryAction === 'open_chrome'
      ? ExternalLink
      : guidance.primaryAction === 'copy_link'
        ? Copy
        : RefreshCw;

  return (
    <div className="pwa-install-banner" role="region" aria-label="Install YES LAB app">
      <div className="pwa-install-banner-inner">
        <span className="pwa-install-banner-icon" aria-hidden>
          <Smartphone size={20} />
        </span>
        <div className="pwa-install-banner-text">
          <strong className="pwa-install-banner-title">{guidance.title}</strong>
          <p className="pwa-install-banner-desc mb-0">
            {installHint || guidance.description}
          </p>
          {blockers.length > 0 && !installHint ? (
            <ul className="pwa-install-banner-blockers mb-0">
              {blockers.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {guidance.primaryAction === 'open_chrome' && !installHint ? (
            <p className="pwa-install-banner-desc mb-0 mt-1">
              <a
                href={CHROME_PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="pwa-install-banner-link"
              >
                Get Google Chrome from Play Store
              </a>
            </p>
          ) : null}
        </div>
        <div className="pwa-install-banner-actions">
          <button
            type="button"
            className="pwa-install-banner-btn pwa-install-banner-btn--primary"
            onClick={() => void handlePrimary()}
            disabled={busy}
          >
            <PrimaryIcon size={16} aria-hidden />
            {busy ? 'Please wait…' : guidance.primaryLabel}
          </button>
          {guidance.primaryAction === 'open_chrome' ? (
            <button
              type="button"
              className="pwa-install-banner-btn pwa-install-banner-btn--secondary"
              onClick={() => void handleCopyLink()}
              aria-label="Copy link for Chrome"
            >
              <Copy size={16} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="pwa-install-banner-btn pwa-install-banner-btn--ghost"
            onClick={handleDismiss}
            aria-label="Dismiss install suggestion"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
