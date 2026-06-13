import React, { useCallback, useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import {
  canShowPwaInstallUi,
  dismissPwaInstallPrompt,
  hasDeferredInstallPrompt,
  isAndroidChrome,
  PWA_INSTALL_AVAILABLE_EVENT,
  triggerPwaInstall,
} from '../lib/pwaInstall';

export const PwaInstallBanner: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [nativePrompt, setNativePrompt] = useState(false);

  const [installHint, setInstallHint] = useState('');

  const refresh = useCallback(() => {
    if (!canShowPwaInstallUi()) {
      setVisible(false);
      return;
    }
    const hasPrompt = hasDeferredInstallPrompt();
    setNativePrompt(hasPrompt);
    setVisible(hasPrompt || isAndroidChrome());
  }, []);

  useEffect(() => {
    refresh();
    const onAvailable = () => refresh();
    window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, onAvailable);
    return () => window.removeEventListener(PWA_INSTALL_AVAILABLE_EVENT, onAvailable);
  }, [refresh]);

  const handleInstall = async () => {
    setInstalling(true);
    setInstallHint('');
    try {
      const outcome = await triggerPwaInstall();
      if (outcome === 'unavailable') {
        setInstallHint(
          'Install is not ready yet. Open Chrome menu (⋮) → Install app, or Add to Home screen. Visit again after signing in if needed.',
        );
        return;
      }
      if (outcome === 'accepted') setVisible(false);
    } finally {
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    dismissPwaInstallPrompt();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="pwa-install-banner" role="region" aria-label="Install YES LAB app">
      <div className="pwa-install-banner-inner">
        <span className="pwa-install-banner-icon" aria-hidden>
          <Smartphone size={20} />
        </span>
        <div className="pwa-install-banner-text">
          <strong className="pwa-install-banner-title">Install YES LAB</strong>
          <p className="pwa-install-banner-desc mb-0">
            {installHint
              || (nativePrompt
                ? 'Add to your home screen for faster access and camera uploads.'
                : 'Use Install below, or Chrome menu (⋮) → Install app / Add to Home screen.')}
          </p>
        </div>
        <div className="pwa-install-banner-actions">
          <button
            type="button"
            className="pwa-install-banner-btn pwa-install-banner-btn--primary"
            onClick={() => void handleInstall()}
            disabled={installing}
          >
            <Download size={16} aria-hidden />
            {installing ? 'Installing…' : 'Install'}
          </button>
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
