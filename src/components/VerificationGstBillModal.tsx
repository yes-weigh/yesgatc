import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Tags, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import {
  getRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
} from '../lib/bluetoothEscposPrinter';
import type { RememberedBluetoothPrinter } from '../lib/bluetoothPrinterStorage';
import {
  buildVerificationGstBillData,
  buildVerificationGstBillShareMessage,
  formatGstBillLineAmount,
  formatGstBillMoney,
  VERIFICATION_GST_BILL_BRANDING,
  VERIFICATION_GST_BILL_RECEIPT,
} from '../lib/verificationGstBill';
import { buildWhatsAppShareUrl } from '../lib/verificationWhatsAppShare';
import {
  formatBluetoothPrintError,
  printVerificationGstBillToBluetooth,
} from '../lib/verificationGstBillPrint';
import type { Customer, SiteCalibration } from '../types';

type VerificationGstBillModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

function GstBillRule() {
  return <div className="verification-gst-bill-rule" aria-hidden />;
}

function GstBillRow({
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

export const VerificationGstBillModal: React.FC<VerificationGstBillModalProps> = ({
  open,
  record,
  onClose,
}) => {
  const receiptRef = useRef<HTMLElement>(null);
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

  const billData = useMemo(
    () => buildVerificationGstBillData(record, customer),
    [record, customer],
  );

  const whatsAppShareUrl = useMemo(() => {
    if (loading) return null;
    return buildWhatsAppShareUrl(
      buildVerificationGstBillShareMessage(billData),
      customer?.phone,
    );
  }, [billData, customer?.phone, loading]);

  const handleBluetoothPrint = async (forcePicker = false) => {
    if (printing || loading) return;

    setPrinting(true);
    setPrintMessage(null);
    setPrintError(null);

    try {
      const { deviceName } = await printVerificationGstBillToBluetooth(billData, {
        forcePicker,
      });
      setSavedPrinter(getRememberedBluetoothPrinter());
      setPrintMessage(`Bill sent to ${deviceName}.`);
    } catch (error) {
      setPrintError(formatBluetoothPrintError(error));
    } finally {
      setPrinting(false);
    }
  };

  const receiptStyle = useMemo(
    () =>
      ({
        '--verification-gst-bill-width': `${VERIFICATION_GST_BILL_RECEIPT.previewWidthPx}px`,
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
        aria-labelledby="verification-gst-bill-title"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="verification-gst-bill-close"
          onClick={onClose}
          aria-label="Close GST bill preview"
        >
          <X size={18} aria-hidden />
        </button>

        <div className="verification-gst-bill-scroll">
          <article
            ref={receiptRef}
            className="verification-gst-bill"
            style={receiptStyle}
            data-verification-gst-bill-print
          >
          <header className="verification-gst-bill-header">
            <p className="verification-gst-bill-company">{VERIFICATION_GST_BILL_BRANDING.companyName}</p>
            {VERIFICATION_GST_BILL_BRANDING.addressLines.map(line => (
              <p key={line} className="verification-gst-bill-address mb-0">
                {line}
              </p>
            ))}
            <p className="verification-gst-bill-gstin mb-0">
              GSTIN : {VERIFICATION_GST_BILL_BRANDING.gstin}
            </p>
          </header>

          <GstBillRule />

          <div className="verification-gst-bill-title-block">
            <p className="verification-gst-bill-title mb-0">TAX INVOICE (B2C)</p>
            <p className="verification-gst-bill-subtitle mb-0">FORM 8B RECEIPT</p>
          </div>

          <GstBillRule />

          <section className="verification-gst-bill-section" aria-label="Invoice details">
            <GstBillRow label="Invoice No" value={billData.invoiceNumber} />
            <GstBillRow label="Date" value={loading ? '…' : billData.invoiceDateTime} />
            <GstBillRow label="Invoice Type" value={VERIFICATION_GST_BILL_BRANDING.invoiceType} />
            <GstBillRow label="Place of Supply" value={VERIFICATION_GST_BILL_BRANDING.placeOfSupply} />
          </section>

          <GstBillRule />

          <section className="verification-gst-bill-section" aria-label="Customer details">
            <GstBillRow label="Customer Name" value={loading ? '…' : billData.customerName} />
            <GstBillRow label="Location" value={loading ? '…' : billData.customerLocation} />
          </section>

          <GstBillRule />

          <section className="verification-gst-bill-lines" aria-label="Line items">
            <div className="verification-gst-bill-lines-head">
              <span>Description</span>
              <span>Amount (₹)</span>
            </div>
            <div className="verification-gst-bill-line-item">
              <span>Verification Fees</span>
              <span>{formatGstBillLineAmount(billData.taxableValue)}</span>
            </div>
          </section>

          <GstBillRule />

          <section className="verification-gst-bill-section" aria-label="Tax breakdown">
            <GstBillRow label="Taxable Value" value={formatGstBillMoney(billData.taxableValue)} />
            <GstBillRow label="CGST @ 9%" value={formatGstBillMoney(billData.cgstAmount)} />
            <GstBillRow label="SGST @ 9%" value={formatGstBillMoney(billData.sgstAmount)} />
          </section>

          <GstBillRule />

          <div className="verification-gst-bill-total">
            <span>TOTAL AMOUNT</span>
            <strong>{formatGstBillMoney(billData.totalAmount)}</strong>
          </div>

          <GstBillRule />

          <section className="verification-gst-bill-section verification-gst-bill-section--block">
            <p className="verification-gst-bill-block-label mb-0">Amount In Words</p>
            <p className="verification-gst-bill-block-value mb-0">{billData.amountInWords}</p>
          </section>

          <GstBillRule />

          <section className="verification-gst-bill-section verification-gst-bill-section--block">
            <p className="verification-gst-bill-block-label mb-0">Payment Mode</p>
            <p className="verification-gst-bill-block-value mb-0">
              {VERIFICATION_GST_BILL_BRANDING.paymentMode}
            </p>
          </section>

          <GstBillRule />

          <section className="verification-gst-bill-section verification-gst-bill-section--block">
            <p className="verification-gst-bill-block-label mb-0">Verification Certificate</p>
            <p className="verification-gst-bill-block-value mb-0">Certificate No :</p>
            <p className="verification-gst-bill-block-value mb-0">{billData.certificateNumber}</p>
          </section>

          <GstBillRule />

          <footer className="verification-gst-bill-footer" aria-label="Receipt footer">
            {VERIFICATION_GST_BILL_BRANDING.footerLines.map(line => (
              <p key={line} className="verification-gst-bill-footer-line mb-0">
                {line}
              </p>
            ))}
          </footer>

          <GstBillRule />

          <div className="verification-gst-bill-footer verification-gst-bill-footnotes">
            <p className="verification-gst-bill-footnote mb-0">This is a computer generated invoice.</p>
            <p className="verification-gst-bill-footnote mb-0">No signature required.</p>
          </div>
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
                  ? 'Printing GST bill'
                  : savedPrinter
                    ? `Print GST bill to ${savedPrinter.name}`
                    : 'Print GST bill'
              }
              title={
                bluetoothPrintSupported
                  ? savedPrinter
                    ? `Print GST bill (${savedPrinter.name})`
                    : 'Print GST bill'
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
                aria-label="Share GST bill on WhatsApp"
                title="Share GST bill on WhatsApp"
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

          {billData.missingFields.length > 0 && !loading && (
            <p className="verification-gst-bill-hint text-muted text-sm mb-0" role="status">
              Incomplete bill data: {billData.missingFields.join(', ')}.
            </p>
          )}
        </div>

        <h2 id="verification-gst-bill-title" className="sr-only">
          GST bill for {record.serialNumber || 'device'}
        </h2>
      </div>
    </div>,
    document.body,
  );
};
