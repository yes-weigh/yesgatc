import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { buildVerificationLabelData, VERIFICATION_LABEL_STICKER } from '../lib/verificationLabel';
import {
  getRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
} from '../lib/bluetoothEscposPrinter';
import type { RememberedBluetoothPrinter } from '../lib/bluetoothPrinterStorage';
import {
  formatBluetoothPrintError,
  printVerificationLabelToBluetooth,
} from '../lib/verificationLabelThermalPrint';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

type VerificationLabelModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

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
  const [savedPrinter, setSavedPrinter] = useState<RememberedBluetoothPrinter | null>(null);
  const bluetoothPrintSupported = isBluetoothEscposSupported();

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;
    setSavedPrinter(getRememberedBluetoothPrinter());
  }, [open]);

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

  const handleBluetoothPrint = async (forcePicker = false) => {
    if (!cardRef.current || printing || loading) return;

    setPrinting(true);
    setPrintMessage(null);
    setPrintError(null);

    try {
      const { deviceName } = await printVerificationLabelToBluetooth(cardRef.current, {
        forcePicker,
      });
      setSavedPrinter(getRememberedBluetoothPrinter());
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
          className="verification-label-card verification-label-card--portrait"
          style={stickerStyle}
          data-verification-label-print
        >
          <div className="verification-label-content">
            <header className="verification-label-header">
              <p className="verification-label-title-line mb-0">VERIFIED &amp;</p>
              <p className="verification-label-title-line mb-0">CERTIFIED</p>
            </header>

            <div className="verification-label-validity">
              <p className="verification-label-valid-till-label mb-0">VALID TILL</p>
              <p className="verification-label-valid-till-date mb-0">{labelData.validTill}</p>
            </div>

            <section className="verification-label-qr-section" aria-label="Verification QR code">
              {labelData.verifyUrl ? (
                <>
                  <div className="verification-label-qr-frame">
                    <QRCode
                      value={labelData.verifyUrl}
                      size={512}
                      bgColor="#FFFFFF"
                      fgColor="#000000"
                      level="M"
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                      aria-hidden
                    />
                  </div>
                  <p className="verification-label-scan-btn mb-0">SCAN TO VERIFY</p>
                </>
              ) : (
                <p className="verification-label-qr-missing mb-0">QR unavailable</p>
              )}
            </section>
          </div>
        </article>

        <div className="verification-label-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm verification-label-print-btn"
            onClick={() => void handleBluetoothPrint()}
            disabled={printing || loading || !bluetoothPrintSupported}
            aria-label={
              printing
                ? 'Printing label'
                : savedPrinter
                  ? `Print label to ${savedPrinter.name}`
                  : 'Print label'
            }
            title={
              bluetoothPrintSupported
                ? savedPrinter
                  ? `Print label (${savedPrinter.name})`
                  : 'Print label'
                : 'Label printing requires Chrome on Android over HTTPS'
            }
          >
            <Printer size={18} strokeWidth={2} aria-hidden />
          </button>
          {bluetoothPrintSupported && savedPrinter && (
            <button
              type="button"
              className="btn btn-secondary btn-sm verification-label-change-printer-btn"
              onClick={() => void handleBluetoothPrint(true)}
              disabled={printing || loading}
            >
              Change printer
            </button>
          )}
        </div>

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
