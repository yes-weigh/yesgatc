import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useRoleBasePath } from '../lib/roleScope';
import {
  playUnsignedCertificateWarningOnce,
  resetUnsignedCertificateWarningSession,
} from '../lib/playUnsignedCertificateWarningSound';
import { UNSIGNED_PDF_DISTURB_THRESHOLD } from '../lib/rcUnsignedPdfPending';

const POPUP_SESSION_KEY = 'yesgatc-unsigned-pdf-warn-popup';

type RcUnsignedCertificateNoticeProps = {
  count: number;
  /** Compact spacing for verification list page. */
  compact?: boolean;
  /** Force popup + sound even when count is 0 (preview / mock). */
  mock?: boolean;
};

function qtyLabelFor(count: number): string {
  if (count <= 0) return 'certificates';
  return count === 1 ? '1 certificate' : `${count.toLocaleString('en-IN')} certificates`;
}

export function RcUnsignedCertificateNotice({
  count,
  compact = false,
  mock = false,
}: RcUnsignedCertificateNoticeProps) {
  const basePath = useRoleBasePath();
  const show = mock || count > 0;
  const displayCount = mock && count <= 0 ? 12 : count;
  const qtyLabel = qtyLabelFor(displayCount);

  const [popupOpen, setPopupOpen] = useState(false);

  // Soft banner popup once; layout host handles >10 disturb on every menu.
  useEffect(() => {
    if (!show) return;
    if (typeof window === 'undefined') return;
    if (mock) {
      resetUnsignedCertificateWarningSession();
      setPopupOpen(true);
      playUnsignedCertificateWarningOnce();
      return;
    }
    if (count <= UNSIGNED_PDF_DISTURB_THRESHOLD) {
      // Soft: one popup per session when any pending.
      if (sessionStorage.getItem(POPUP_SESSION_KEY) === '1') {
        playUnsignedCertificateWarningOnce();
        return;
      }
      setPopupOpen(true);
      playUnsignedCertificateWarningOnce();
      return;
    }
    // Heavy backlog: layout disturb host owns popups — skip soft session popup here.
    playUnsignedCertificateWarningOnce();
  }, [mock, show, count]);

  const dismissPopup = () => {
    setPopupOpen(false);
    if (!mock) sessionStorage.setItem(POPUP_SESSION_KEY, '1');
  };

  if (!show) return null;

  const banner = (
    <div
      className={`rc-vehicle-required-notice rc-unsigned-cert-notice${compact ? ' rc-unsigned-cert-notice--compact' : ''}`}
      role="alert"
    >
      <p className="rc-vehicle-required-notice__title">
        Signed certificate PDF pending — {qtyLabel}
      </p>
      <p className="rc-vehicle-required-notice__text mb-0">
        Your centre has {qtyLabel} marked <strong>No signed PDF</strong>. Please download each
        certificate, sign with your Class 3 DSC, and upload the signed file so it can be issued on
        eMAAP. Kindly complete this promptly — until the backlog is cleared, new verification
        submissions may be interrupted or delayed.
      </p>
      <div className="rc-unsigned-cert-notice__actions">
        <Link
          to={`${basePath}/certificates?status=not_signed`}
          className="btn btn-secondary btn-sm"
        >
          Review unsigned certificates
        </Link>
      </div>
    </div>
  );

  const popup = popupOpen
    ? createPortal(
        <div
          className="rc-unsigned-cert-popup-overlay"
          role="presentation"
          onClick={dismissPopup}
        >
          <div
            className="rc-unsigned-cert-popup"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="rc-unsigned-cert-popup-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="rc-unsigned-cert-popup__close"
              onClick={dismissPopup}
              aria-label="Dismiss"
            >
              <X size={18} />
            </button>
            <span className="rc-unsigned-cert-popup__icon" aria-hidden>
              <AlertTriangle size={28} strokeWidth={2.2} />
            </span>
            <h2 id="rc-unsigned-cert-popup-title" className="rc-unsigned-cert-popup__title">
              Action required: signed PDF pending
            </h2>
            <p className="rc-unsigned-cert-popup__qty">{qtyLabel}</p>
            <p className="rc-unsigned-cert-popup__text">
              Certificates under your centre still show <strong>No signed PDF</strong>. Download,
              sign with Class 3 DSC, and upload so eMAAP can issue them. Please clear this backlog
              promptly — new verification submissions may otherwise be interrupted or delayed.
            </p>
            {mock ? (
              <p className="rc-unsigned-cert-popup__mock">Mock preview — sample count</p>
            ) : null}
            <div className="rc-unsigned-cert-popup__actions">
              <Link
                to={`${basePath}/certificates?status=not_signed`}
                className="btn btn-secondary"
                onClick={dismissPopup}
              >
                Review unsigned
              </Link>
              <button type="button" className="btn btn-secondary" onClick={dismissPopup}>
                Dismiss
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {banner}
      {popup}
    </>
  );
}
