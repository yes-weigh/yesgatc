import React, { useCallback, useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import {
  bindPwaInstallListeners,
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
    bindPwaInstallListeners();
    refresh();
    const onAvailable = () => refresh();
    window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, onAvailable);
    return () => window.removeEventListener(PWA_INSTALL_AVAILABLE_EVENT, onAvailable);
  }, [refresh]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const outcome = await triggerPwaInstall();
      if (outcome === 'unavailable') {
        // Chrome may still need menu install before engagement criteria are met.
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
            {nativePrompt
              ? 'Add to your home screen for faster access and camera uploads.'
              : 'Open Chrome menu (⋮) and tap Install app, or use the button when available.'}
          </p>
        </div>
        <div className="pwa-install-banner-actions">
          {nativePrompt && (
            <button
              type="button"
              className="pwa-install-banner-btn pwa-install-banner-btn--primary"
              onClick={() => void handleInstall()}
              disabled={installing}
            >
              <Download size={16} aria-hidden />
              {installing ? 'Installing…' : 'Install'}
            </button>
          )}
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
