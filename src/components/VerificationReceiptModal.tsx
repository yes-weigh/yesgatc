import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Tags, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import {
  getRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
} from '../lib/bluetoothEscposPrinter';
import type { RememberedBluetoothPrinter } from '../lib/bluetoothPrinterStorage';
import { DEFAULT_RC_FEES_STRUCTURE } from '../lib/rcProfileFields';
import {
  buildVerificationReceiptData,
  buildVerificationReceiptShareMessage,
  formatReceiptLineAmount,
  formatReceiptMoney,
  VERIFICATION_RECEIPT_BRANDING,
  VERIFICATION_RECEIPT_THERMAL,
} from '../lib/verificationReceipt';
import { buildWhatsAppShareUrl } from '../lib/verificationWhatsAppShare';
import {
  formatBluetoothPrintError,
  printVerificationReceiptToBluetooth,
} from '../lib/verificationReceiptPrint';
import type { Customer, SiteCalibration } from '../types';

type VerificationReceiptModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

function ReceiptRule() {
  return <div className="verification-gst-bill-rule" aria-hidden />;
}

function ReceiptRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={`verification-gst-bill-row${strong ? ' verification-gst-bill-row--strong' : ''}`}>
      <span className="verification-gst-bill-row-label">{label}</span>
      <span className="verification-gst-bill-row-colon" aria-hidden>
        :
      </span>
      <span className="verification-gst-bill-row-value">{value}</span>
    </div>
  );
}

export const VerificationReceiptModal: React.FC<VerificationReceiptModalProps> = ({
  open,
  record,
  onClose,
}) => {
  const receiptRef = useRef<HTMLElement>(null);
  const { products } = useAppContext();
  const fees = DEFAULT_RC_FEES_STRUCTURE;
  const [customer, setCustomer] = useState<Customer | null>(null);
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

    const customerId = record.customerId?.trim();
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const customerSnap = customerId ? await getDoc(doc(db, 'customers', customerId)) : null;
        if (cancelled) return;
        setCustomer(customerSnap?.exists() ? ({ id: customerSnap.id, ...customerSnap.data() } as Customer) : null);
      } catch {
        if (!cancelled) setCustomer(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, record.customerId]);

  const receiptData = useMemo(
    () => buildVerificationReceiptData(record, customer, products, fees),
    [record, customer, products, fees],
  );

  const whatsAppShareUrl = useMemo(() => {
    if (loading) return null;
    return buildWhatsAppShareUrl(
      buildVerificationReceiptShareMessage(receiptData),
      customer?.phone,
    );
  }, [receiptData, customer?.phone, loading]);

  const handleBluetoothPrint = async (forcePicker = false) => {
    if (printing || loading) return;

    setPrinting(true);
    setPrintMessage(null);
    setPrintError(null);

    try {
      const { deviceName } = await printVerificationReceiptToBluetooth(receiptData, {
        forcePicker,
      });
      setSavedPrinter(getRememberedBluetoothPrinter());
      setPrintMessage(`Receipt sent to ${deviceName}.`);
    } catch (error) {
      setPrintError(formatBluetoothPrintError(error));
    } finally {
      setPrinting(false);
    }
  };

  const receiptStyle = useMemo(
    () =>
      ({
        '--verification-gst-bill-width': `${VERIFICATION_RECEIPT_THERMAL.previewWidthPx}px`,
      }) as React.CSSProperties,
    [],
  );

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay verification-gst-bill-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="verification-gst-bill-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-receipt-title"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="verification-gst-bill-close"
          onClick={onClose}
          aria-label="Close receipt preview"
        >
          <X size={18} aria-hidden />
        </button>

        <div className="verification-gst-bill-scroll">
          <article
            ref={receiptRef}
            className="verification-gst-bill"
            style={receiptStyle}
            data-verification-receipt-print
          >
            <header className="verification-gst-bill-header">
              <p className="verification-gst-bill-company">{VERIFICATION_RECEIPT_BRANDING.companyName}</p>
              {VERIFICATION_RECEIPT_BRANDING.addressLines.map(line => (
                <p key={line} className="verification-gst-bill-address mb-0">
                  {line}
                </p>
              ))}
              <p className="verification-gst-bill-gstin mb-0">
                GSTIN : {VERIFICATION_RECEIPT_BRANDING.gstin}
              </p>
            </header>

            <ReceiptRule />

            <div className="verification-gst-bill-title-block">
              <p className="verification-gst-bill-title mb-0">CASH RECEIPT</p>
            </div>

            <ReceiptRule />

            <section className="verification-gst-bill-section" aria-label="Receipt details">
              <ReceiptRow label="Receipt No" value={receiptData.receiptNumber} />
              <ReceiptRow label="Date" value={loading ? '…' : receiptData.receiptDate} />
              <ReceiptRow label="Time" value={loading ? '…' : receiptData.receiptTime} />
            </section>

            <ReceiptRule />

            <section className="verification-gst-bill-section" aria-label="Customer details">
              <ReceiptRow label="Customer Name" value={loading ? '…' : receiptData.customerName} />
              <ReceiptRow label="Location" value={loading ? '…' : receiptData.customerLocation} />
            </section>

            <ReceiptRule />

            <section className="verification-gst-bill-lines" aria-label="Line items">
              <div className="verification-gst-bill-lines-head">
                <span>Description</span>
                <span>Amount (₹)</span>
              </div>
              <div className="verification-gst-bill-line-item">
                <span>{receiptData.lineDescription}</span>
                <span>{formatReceiptLineAmount(receiptData.amount)}</span>
              </div>
            </section>

            <ReceiptRule />

            <div className="verification-gst-bill-total">
              <span>Total Amount</span>
              <strong>{formatReceiptMoney(receiptData.totalAmount)}</strong>
            </div>

            <ReceiptRule />

            <section className="verification-gst-bill-section verification-gst-bill-section--block">
              <p className="verification-gst-bill-block-label mb-0">Amount In Words</p>
              <p className="verification-gst-bill-block-value mb-0">{receiptData.amountInWords}</p>
            </section>

            <ReceiptRule />

            <section className="verification-gst-bill-section verification-gst-bill-section--block">
              <p className="verification-gst-bill-block-label mb-0">Payment Mode</p>
              <p className="verification-gst-bill-block-value mb-0">
                {VERIFICATION_RECEIPT_BRANDING.paymentMode}
              </p>
            </section>

            <ReceiptRule />

            <footer className="verification-gst-bill-footer">
              {VERIFICATION_RECEIPT_BRANDING.footerLines.map(line => (
                <p key={line} className="verification-gst-bill-footer-line mb-0">
                  {line}
                </p>
              ))}
            </footer>

            <ReceiptRule />

            <p className="verification-gst-bill-footnote mb-0">This is a computer generated receipt.</p>
            <p className="verification-gst-bill-footnote mb-0">No signature required.</p>
          </article>
        </div>

        <div className="verification-gst-bill-toolbar">
          <div className="verification-gst-bill-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm verification-gst-bill-print-btn"
              onClick={() => void handleBluetoothPrint()}
              disabled={printing || loading || !bluetoothPrintSupported}
              aria-label={
                printing
                  ? 'Printing receipt'
                  : savedPrinter
                    ? `Print receipt to ${savedPrinter.name}`
                    : 'Print receipt'
              }
              title={
                bluetoothPrintSupported
                  ? savedPrinter
                    ? `Print receipt (${savedPrinter.name})`
                    : 'Print receipt'
                  : 'Printing requires Chrome on Android over HTTPS'
              }
            >
              <Tags size={18} aria-hidden />
            </button>
            {whatsAppShareUrl && (
              <a
                href={whatsAppShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-sm verification-gst-bill-whatsapp-btn"
                aria-label="Share receipt on WhatsApp"
                title="Share receipt on WhatsApp"
              >
                <MessageCircle size={18} aria-hidden />
              </a>
            )}
            {bluetoothPrintSupported && savedPrinter && (
              <button
                type="button"
                className="btn btn-secondary btn-sm verification-gst-bill-change-printer-btn"
                onClick={() => void handleBluetoothPrint(true)}
                disabled={printing || loading}
              >
                Change printer
              </button>
            )}
          </div>

          {printMessage && (
            <p className="verification-gst-bill-print-status text-sm mb-0" role="status">
              {printMessage}
            </p>
          )}

          {printError && (
            <p className="verification-gst-bill-print-error text-sm mb-0" role="alert">
              {printError}
            </p>
          )}

          {receiptData.missingFields.length > 0 && !loading && (
            <p className="verification-gst-bill-hint text-muted text-sm mb-0" role="status">
              Incomplete receipt data: {receiptData.missingFields.join(', ')}.
            </p>
          )}
        </div>

        <h2 id="verification-receipt-title" className="sr-only">
          Wallet receipt for {record.serialNumber || 'device'}
        </h2>
      </div>
    </div>,
    document.body,
  );
};
