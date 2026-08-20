import React from 'react';
import { Download } from 'lucide-react';
import { EMAAP_ENGINE_ZIP_URL } from '../lib/emaapEngineDownload';

export const EmaapEngineDownloadCard: React.FC = () => (
  <section className="wl-live wl-live--idle" aria-label="EmaapEngine">
    <div className="wl-live__head">
      <p className="wl-live__state">EmaapEngine</p>
    </div>
    <p className="wl-live__msg">
      Windows app for this RC only. Sign in with RC Aadhar and password. Captcha and OTP stay
      manual. VPS worker pauses while this PC is online.
    </p>
    <div className="wl-live__actions">
      <a className="wl-live__restart" href={EMAAP_ENGINE_ZIP_URL}>
        <Download size={15} strokeWidth={2.2} aria-hidden />
        Download EmaapEngine.exe
      </a>
    </div>
  </section>
);
