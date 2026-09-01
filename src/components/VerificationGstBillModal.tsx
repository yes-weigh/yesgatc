import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCode } from 'react-qr-code';
import { Printer, Share2, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import {
  beginBluetoothPrinterSelection,
  getRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
  warmupRememberedBluetoothPrinter,
} from '../lib/bluetoothEscposPrinter';
import type { RememberedBluetoothPrinter } from '../lib/bluetoothPrinterStorage';
import {
  buildVerificationGstBillData,
  formatGstBillLineAmount,
  formatGstBillMoney,
  groupGstBillInstrumentRows,
  VERIFICATION_GST_BILL_BRANDING,
  VERIFICATION_GST_BILL_LINE_DESCRIPTION,
  VERIFICATION_GST_BILL_QR_CAPTION,
  VERIFICATION_GST_BILL_RECEIPT,
  VERIFICATION_GST_BILL_SAC_LINE,
} from '../lib/verificationGstBill';
import {
  formatReceiptShareError,
  shareElementImageOnPhone,
} from '../lib/verificationReceiptShare';
import {
  formatBluetoothPrintError,
  printVerificationGstBillToBluetooth,
} from '../lib/verificationGstBillPrint';
import { useVerificationDetailDocs } from '../hooks/useVerificationDetailDocs';
import { readEmaapCertificatePdfUrl } from '../lib/certificateVerifyUrl';
import { resolveCertificatePdfQrUrl } from '../lib/certificatePdfQr';
import type { Customer, SiteCalibration } from '../types';

type VerificationGstBillModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

function GstBillRule({ solid = false }: { solid?: boolean }) {
  return (
    <div
      className={`verification-gst-bill-rule${solid ? ' verification-gst-bill-rule--solid' : ''}`}
      aria-hidden
    />
  );
}

function GstBillInstrumentField({
  line,
  loading,
}: {
  line: { label: string; value: string };
  loading: boolean;
}) {
  return (
    <>
      <span className="verification-gst-bill-instrument-k">{line.label} :</span>
      <span className="verification-gst-bill-instrument-v">{loading ? '…' : line.value}</span>
    </>
  );
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
  const [liveRecord, setLiveRecord] = useState<SiteCalibration | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const billRecord = liveRecord ?? record;
  const { product } = useVerificationDetailDocs(billRecord);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [savedPrinter, setSavedPrinter] = useState<RememberedBluetoothPrinter | null>(null);
  const [pdfQrUrl, setPdfQrUrl] = useState<string | null>(null);
  const bluetoothPrintSupported = isBluetoothEscposSupported();

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;
    setSavedPrinter(getRememberedBluetoothPrinter());
    void warmupRememberedBluetoothPrinter().then(device => {
      if (device) setSavedPrinter(getRememberedBluetoothPrinter());
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      setLiveRecord(null);
      return;
    }

    let cancelled = false;
    void getDoc(doc(db, 'siteCalibrations', record.id))
      .then(snap => {
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        const emaapCertificatePdfUrl = readEmaapCertificatePdfUrl(data);
        setLiveRecord({
          id: snap.id,
          ...data,
          ...(emaapCertificatePdfUrl ? { emaapCertificatePdfUrl } : {}),
        } as SiteCalibration);
      })
      .catch(() => {
        if (!cancelled) setLiveRecord(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, record.id]);

  useEffect(() => {
    if (!open) return;

    const ids = [
      ...new Set(
        [record.customerId, record.sourceCustomerId]
          .map(id => id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        let loaded: Customer | null = null;
        for (const id of ids) {
          const customerSnap = await getDoc(doc(db, 'customers', id));
          if (cancelled) return;
          if (customerSnap.exists()) {
            loaded = { id: customerSnap.id, ...customerSnap.data() } as Customer;
            break;
          }
        }
        if (!cancelled) setCustomer(loaded);
      } catch {
        if (!cancelled) setCustomer(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, record.customerId, record.sourceCustomerId]);

  useEffect(() => {
    if (!open) {
      setPdfQrUrl(null);
      return;
    }

    let cancelled = false;
    void resolveCertificatePdfQrUrl(billRecord).then(url => {
      if (!cancelled) setPdfQrUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    billRecord.id,
    billRecord.emaapCertificatePdfUrl,
    billRecord.certificatePdfUrl,
    billRecord.certificatePdfPath,
    billRecord.signedCertificatePdfUrl,
    billRecord.signedCertificatePdfPath,
  ]);

  const billData = useMemo(() => {
    const built = buildVerificationGstBillData(billRecord, customer, product);
    return {
      ...built,
      verifyUrl: pdfQrUrl || built.verifyUrl,
    };
  }, [billRecord, customer, product, pdfQrUrl]);

  const handleShare = async () => {
    const node = receiptRef.current;
    if (!node || sharing || loading) return;
    setSharing(true);
    setPrintMessage(null);
    setPrintError(null);
    try {
      const invoice = billData.invoiceNumber.replace(/[^\w.-]+/g, '-') || 'gst-bill';
      await shareElementImageOnPhone({
        element: node,
        fileName: `${invoice}.jpg`,
        title: `GST bill ${billData.invoiceNumber}`.trim(),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setPrintError(formatReceiptShareError(error));
    } finally {
      setSharing(false);
    }
  };

  const handleBluetoothPrint = async (forcePicker = false) => {
    const node = receiptRef.current;
    if (!node || printing || loading) return;

    let devicePromise: Promise<BluetoothDevice>;
    try {
      devicePromise = beginBluetoothPrinterSelection({ forcePicker });
    } catch (error) {
      setPrintError(formatBluetoothPrintError(error));
      return;
    }

    setPrinting(true);
    setPrintMessage(null);
    setPrintError(null);

    try {
      const { deviceName } = await printVerificationGstBillToBluetooth(node, {
        forcePicker,
        device: devicePromise,
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
        className="verification-gst-bill-dialog verification-gst-bill-dialog--doc-chrome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-gst-bill-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="verification-gst-bill-chrome">
          <button
            type="button"
            className="verification-gst-bill-icon-btn verification-gst-bill-icon-btn--close"
            onClick={onClose}
            aria-label="Close GST bill preview"
          >
            <X size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="verification-gst-bill-icon-btn verification-gst-bill-icon-btn--print"
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
            <Printer size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="verification-gst-bill-icon-btn verification-gst-bill-icon-btn--share"
            onClick={() => void handleShare()}
            disabled={sharing || loading}
            aria-label="Share GST bill"
            title="Share"
          >
            <Share2 size={18} aria-hidden />
          </button>
        </div>
        {bluetoothPrintSupported ? (
          savedPrinter ? (
            <button
              type="button"
              className="verification-gst-bill-change-printer-link"
              onClick={() => void handleBluetoothPrint(true)}
              disabled={printing || loading}
            >
              {savedPrinter.name} · change
            </button>
          ) : (
            <button
              type="button"
              className="verification-gst-bill-change-printer-link"
              onClick={() => void handleBluetoothPrint(true)}
              disabled={printing || loading}
            >
              Select Bluetooth printer
            </button>
          )
        ) : null}

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
            <GstBillRow label="Phone" value={loading ? '…' : billData.customerPhone} />
            <GstBillRow label="Place" value={loading ? '…' : billData.customerAddress} />
            <GstBillRow label="Pincode" value={loading ? '…' : billData.customerPincode} />
            <GstBillRow label="District" value={loading ? '…' : billData.customerDistrict} />
            <GstBillRow label="State" value={loading ? '…' : billData.customerState} />
          </section>

          <GstBillRule />

          <section className="verification-gst-bill-lines" aria-label="Line items">
            <div className="verification-gst-bill-lines-head">
              <span>Description</span>
              <span>Amount (₹)</span>
            </div>
            <div className="verification-gst-bill-line-item verification-gst-bill-line-item--strong">
              <span>{VERIFICATION_GST_BILL_LINE_DESCRIPTION}</span>
              <span>{formatGstBillLineAmount(billData.taxableValue)}</span>
            </div>
            <p className="verification-gst-bill-line-meta mb-0">{VERIFICATION_GST_BILL_SAC_LINE}</p>
          </section>

          <GstBillRule solid />

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

          <section className="verification-gst-bill-instrument" aria-label="Instrument details">
            <p className="verification-gst-bill-block-label mb-0">Instrument Details</p>
            <div className="verification-gst-bill-instrument-grid">
              {groupGstBillInstrumentRows(billData.instrumentLines).map(row =>
                row.kind === 'pair' ? (
                  <div
                    key={`${row.left.label}-${row.right.label}`}
                    className="verification-gst-bill-instrument-pair"
                  >
                    <GstBillInstrumentField line={row.left} loading={loading} />
                    <GstBillInstrumentField line={row.right} loading={loading} />
                  </div>
                ) : row.line.plain ? (
                  <p key="instrument-spec" className="verification-gst-bill-instrument-spec mb-0">
                    {loading ? '…' : row.line.value}
                  </p>
                ) : (
                  <div key={row.line.label} className="verification-gst-bill-instrument-full">
                    <GstBillInstrumentField line={row.line} loading={loading} />
                  </div>
                ),
              )}
            </div>
            {billData.verifyUrl ? (
              <div className="verification-gst-bill-verify-qr">
                <div className="verification-gst-bill-verify-qr-frame">
                  <QRCode
                    value={billData.verifyUrl}
                    size={192}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                    level="M"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                    aria-hidden
                  />
                </div>
                <p className="verification-gst-bill-verify-qr-caption mb-0">
                  {VERIFICATION_GST_BILL_QR_CAPTION}
                </p>
              </div>
            ) : null}
          </section>

          <GstBillRule />

          <footer className="verification-gst-bill-footer" aria-label="Receipt footer">
            {VERIFICATION_GST_BILL_BRANDING.footerLines.map(line => (
              <p key={line} className="verification-gst-bill-footer-line mb-0">
                {line}
              </p>
            ))}
          </footer>
          </article>
        </div>

        {(printMessage || printError || (billData.missingFields.length > 0 && !loading)) && (
        <div className="verification-gst-bill-toolbar verification-gst-bill-toolbar--status">
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
        )}

        <h2 id="verification-gst-bill-title" className="sr-only">
          GST bill for {record.serialNumber || 'device'}
        </h2>
      </div>
    </div>,
    document.body,
  );
};
