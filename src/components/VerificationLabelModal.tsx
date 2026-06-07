import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bluetooth,
  Calendar,
  MessageCircle,
  ScrollText,
  Shield,
  ShieldCheck,
  X,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import {
  buildVerificationLabelData,
  VERIFICATION_LABEL_BRANDING,
  VERIFICATION_LABEL_STICKER,
} from '../lib/verificationLabel';
import { isBluetoothEscposSupported } from '../lib/bluetoothEscposPrinter';
import {
  formatBluetoothPrintError,
  getBluetoothPrintHelpText,
  printVerificationLabelToBluetooth,
} from '../lib/verificationLabelThermalPrint';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

type VerificationLabelModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

function LabelInfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  label: string;
  value: string;
}) {
  return (
    <div className="verification-label-info-row">
      <span className="verification-label-info-icon" aria-hidden>
        <Icon size={15} strokeWidth={2} />
      </span>
      <div className="verification-label-info-copy">
        <span className="verification-label-info-label">{label}</span>
        <span className="verification-label-info-value">{value}</span>
      </div>
    </div>
  );
}

export const VerificationLabelModal: React.FC<VerificationLabelModalProps> = ({
  open,
  record,
  onClose,
}) => {
  const cardRef = useRef<HTMLElement>(null);
  const [rcPhone, setRcPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const bluetoothPrintSupported = isBluetoothEscposSupported();

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;

    const rcId = record.rcId?.trim();

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const rcSnap = rcId ? await getDoc(doc(db, 'users', rcId)) : null;

        if (cancelled) return;

        setRcPhone(
          rcSnap?.exists() ? ((rcSnap.data() as FirestoreUserDoc).phone ?? null) : null,
        );
      } catch {
        if (!cancelled) setRcPhone(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, record.rcId]);

  const labelData = useMemo(
    () => buildVerificationLabelData(record, rcPhone),
    [record, rcPhone],
  );

  const handleBluetoothPrint = async () => {
    if (!cardRef.current || printing || loading) return;

    setPrinting(true);
    setPrintMessage(null);
    setPrintError(null);

    try {
      const { deviceName } = await printVerificationLabelToBluetooth(cardRef.current);
      setPrintMessage(`Label sent to ${deviceName}.`);
    } catch (error) {
      setPrintError(formatBluetoothPrintError(error));
    } finally {
      setPrinting(false);
    }
  };

  const stickerStyle = useMemo(
    () =>
      ({
        '--verification-label-width': `${VERIFICATION_LABEL_STICKER.previewWidthPx}px`,
        '--verification-label-aspect': `${VERIFICATION_LABEL_STICKER.widthMm} / ${VERIFICATION_LABEL_STICKER.heightMm}`,
        '--vl-details-height': `${VERIFICATION_LABEL_STICKER.detailsHeightMm}mm`,
      }) as React.CSSProperties,
    [],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay verification-label-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="verification-label-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-label-title"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="verification-label-close"
          onClick={onClose}
          aria-label="Close label preview"
        >
          <X size={18} aria-hidden />
        </button>

        <article
          ref={cardRef}
          className="verification-label-card"
          style={stickerStyle}
          data-verification-label-print
        >
          <header className="verification-label-header">
            <div className="verification-label-brand">
              <div className="verification-label-brand-block">
                <div className="verification-label-brand-top">
                  <span className="verification-label-logo-wrap" aria-hidden>
                    <img
                      src={VERIFICATION_LABEL_BRANDING.logoSrc}
                      alt=""
                      className="verification-label-logo"
                    />
                  </span>
                  <p className="verification-label-brand-name">{VERIFICATION_LABEL_BRANDING.logoAlt}</p>
                </div>
                <p className="verification-label-badge">★VERIFIED &amp; CERTIFIED★</p>
                <p className="verification-label-subtitle">AS PER LEGAL METROLOGY RULES</p>
              </div>
            </div>
            <div className="verification-label-govt-rule" aria-hidden />
            <div className="verification-label-govt" aria-hidden>
              {VERIFICATION_LABEL_BRANDING.governmentApprovedLines.map(line => (
                <span key={line}>{line}</span>
              ))}
            </div>
          </header>

          <div className="verification-label-body">
            <div className="verification-label-details">
              <LabelInfoRow
                icon={Shield}
                label="APPROVAL NUMBER"
                value={labelData.approvalNumber}
              />
              <LabelInfoRow
                icon={ScrollText}
                label="CERTIFICATE NUMBER"
                value={labelData.certificateNumber}
              />
              <LabelInfoRow
                icon={Calendar}
                label="VALID TILL"
                value={labelData.validTill}
              />
            </div>

            <div className="verification-label-qr-panel">
              {labelData.verifyUrl ? (
                <>
                  <div className="verification-label-qr-frame">
                    <QRCode
                      value={labelData.verifyUrl}
                      size={112}
                      bgColor="#FFFFFF"
                      fgColor="#000000"
                      level="M"
                      aria-hidden
                    />
                  </div>
                  <a
                    href={labelData.verifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="verification-label-scan-btn"
                  >
                    SCAN TO VERIFY
                  </a>
                </>
              ) : (
                <p className="verification-label-qr-missing mb-0">QR unavailable</p>
              )}
            </div>
          </div>

          <footer className="verification-label-footer">
            <div className="verification-label-stamped">
              <ShieldCheck size={18} strokeWidth={1.85} aria-hidden />
              <span className="verification-label-stamped-lines" aria-hidden>
                <span>VERIFIED &amp;</span>
                <span>STAMPED</span>
              </span>
            </div>
            <div className="verification-label-footer-company">
              <p className="verification-label-company-name mb-0">
                {VERIFICATION_LABEL_BRANDING.companyName}
              </p>
              <div className="verification-label-contact">
                {labelData.rcWhatsAppUrl ? (
                  <a
                    href={labelData.rcWhatsAppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="verification-label-contact-link"
                  >
                    <MessageCircle size={12} strokeWidth={2} aria-hidden />
                    <span>{loading ? '…' : labelData.rcPhoneDisplay}</span>
                  </a>
                ) : (
                  <span className="verification-label-contact-link verification-label-contact-link--static">
                    <MessageCircle size={12} strokeWidth={2} aria-hidden />
                    <span>{loading ? '…' : labelData.rcPhoneDisplay}</span>
                  </span>
                )}
              </div>
            </div>
          </footer>
        </article>

        <div className="verification-label-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm verification-label-print-btn"
            onClick={() => void handleBluetoothPrint()}
            disabled={printing || loading || !bluetoothPrintSupported}
            title={
              bluetoothPrintSupported
                ? 'Print sticker to Bluetooth ESC/POS printer'
                : 'Bluetooth printing requires Chrome on Android over HTTPS'
            }
          >
            <Bluetooth size={16} aria-hidden />
            <span>{printing ? 'Printing…' : 'Print to Bluetooth'}</span>
          </button>
        </div>

        <p className="verification-label-size-note text-muted text-xs mb-0">
          Sticker size {VERIFICATION_LABEL_STICKER.widthMm} × {VERIFICATION_LABEL_STICKER.heightMm} mm
          {bluetoothPrintSupported ? '' : ' · Bluetooth print unavailable in this browser'}
        </p>

        <p className="verification-label-print-help text-muted text-xs mb-0">
          {getBluetoothPrintHelpText()}
        </p>

        {printMessage && (
          <p className="verification-label-print-status text-sm mb-0" role="status">
            {printMessage}
          </p>
        )}

        {printError && (
          <p className="verification-label-print-error text-sm mb-0" role="alert">
            {printError}
          </p>
        )}

        {labelData.missingFields.length > 0 && !loading && (
          <p className="verification-label-hint text-muted text-sm mb-0" role="status">
            Incomplete label data: {labelData.missingFields.join(', ')}.
          </p>
        )}

        <h2 id="verification-label-title" className="sr-only">
          Verification label for {record.serialNumber || 'device'}
        </h2>
      </div>
    </div>,
    document.body,
  );
};
