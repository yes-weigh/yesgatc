import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { resolveRcFeesStructure } from '../lib/rcProfileFields';
import {
  buildVerificationReceiptData,
  formatReceiptLineAmount,
  formatReceiptMoney,
  VERIFICATION_RECEIPT_THERMAL,
} from '../lib/verificationReceipt';
import {
  formatReceiptShareError,
  shareElementImageOnPhone,
} from '../lib/verificationReceiptShare';
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../types';

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
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="verification-gst-bill-row verification-gst-bill-row--strong">
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
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [rc, setRc] = useState<FirestoreUserDoc | null>(null);
  const [vct, setVct] = useState<FirestoreUserDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const fees = resolveRcFeesStructure(rc);

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;

    const customerId = record.customerId?.trim();
    const rcId = record.rcId?.trim();
    const vctId = record.vctId?.trim();
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const [customerSnap, rcSnap, vctSnap] = await Promise.all([
          customerId ? getDoc(doc(db, 'customers', customerId)) : Promise.resolve(null),
          rcId ? getDoc(doc(db, 'users', rcId)) : Promise.resolve(null),
          vctId ? getDoc(doc(db, 'users', vctId)) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setCustomer(
          customerSnap?.exists() ? ({ id: customerSnap.id, ...customerSnap.data() } as Customer) : null,
        );
        setRc(rcSnap?.exists() ? (rcSnap.data() as FirestoreUserDoc) : null);
        setVct(vctSnap?.exists() ? (vctSnap.data() as FirestoreUserDoc) : null);
      } catch {
        if (!cancelled) {
          setCustomer(null);
          setRc(null);
          setVct(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, record.customerId, record.rcId, record.vctId]);

  const receiptData = useMemo(
    () => buildVerificationReceiptData(record, customer, products, fees, rc, vct),
    [record, customer, products, fees, rc, vct],
  );

  const handleShare = async () => {
    const node = receiptRef.current;
    if (!node || sharing || loading) return;

    setSharing(true);
    setShareError(null);

    try {
      const receiptNo = receiptData.receiptNumber.replace(/[^\w.-]+/g, '-') || 'wallet-receipt';
      await shareElementImageOnPhone({
        element: node,
        fileName: `${receiptNo}.jpg`,
        title: `Cash receipt ${receiptData.receiptNumber}`.trim(),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareError(formatReceiptShareError(error));
    } finally {
      setSharing(false);
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
        className="verification-gst-bill-dialog verification-gst-bill-dialog--doc-chrome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-receipt-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="verification-gst-bill-chrome">
          <button
            type="button"
            className="verification-gst-bill-icon-btn verification-gst-bill-icon-btn--close"
            onClick={onClose}
            aria-label="Close receipt preview"
          >
            <X size={18} aria-hidden />
          </button>
          <button
            type="button"
            className="verification-gst-bill-icon-btn verification-gst-bill-icon-btn--share"
            onClick={() => void handleShare()}
            disabled={sharing || loading}
            aria-label="Share cash receipt"
            title="Share"
          >
            <Share2 size={18} aria-hidden />
          </button>
        </div>

        <div className="verification-gst-bill-scroll">
          <article
            ref={receiptRef}
            className="verification-gst-bill verification-cash-receipt"
            style={receiptStyle}
            data-verification-receipt-print
          >
            <header className="verification-gst-bill-header">
              <p className="verification-gst-bill-company">{receiptData.issuer.companyName}</p>
              {receiptData.issuer.addressLines.map((line, index) => (
                <p key={`${index}-${line}`} className="verification-gst-bill-address mb-0">
                  {line}
                </p>
              ))}
              {receiptData.issuer.phone ? (
                <p className="verification-gst-bill-gstin verification-cash-receipt-phone mb-0">
                  Ph: {receiptData.issuer.phone}
                </p>
              ) : null}
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
              <ReceiptRow label="Phone" value={loading ? '…' : receiptData.customerPhone} />
              <ReceiptRow label="Place" value={loading ? '…' : receiptData.customerAddress} />
              <ReceiptRow label="Pincode" value={loading ? '…' : receiptData.customerPincode} />
              <ReceiptRow label="District" value={loading ? '…' : receiptData.customerDistrict} />
              <ReceiptRow label="State" value={loading ? '…' : receiptData.customerState} />
              <ReceiptRow label="VCT Name" value={loading ? '…' : receiptData.vctName} />
              <ReceiptRow label="VCT Number" value={loading ? '…' : receiptData.vctNumber} />
            </section>

            <ReceiptRule />

            <section className="verification-gst-bill-lines" aria-label="Line items">
              <div className="verification-gst-bill-lines-head">
                <span>Description</span>
                <span>Amount (₹)</span>
              </div>
              {receiptData.lines.map(line => (
                <div key={line.description} className="verification-gst-bill-line-item">
                  <span>{line.description}</span>
                  <span>{formatReceiptLineAmount(line.amount)}</span>
                </div>
              ))}
            </section>

            <ReceiptRule />

            <div className="verification-gst-bill-total">
              <span>Cash Total</span>
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
                {receiptData.issuer.paymentMode}
              </p>
            </section>

            <ReceiptRule />

            <div className="verification-gst-bill-footer verification-gst-bill-footnotes">
              <p className="verification-gst-bill-footnote mb-0">This is a computer generated receipt.</p>
              <p className="verification-gst-bill-footnote mb-0">No signature required.</p>
            </div>
          </article>
        </div>

        {(shareError || (receiptData.missingFields.length > 0 && !loading)) && (
          <div className="verification-gst-bill-toolbar">
            {shareError && (
              <p className="verification-gst-bill-print-error text-sm mb-0" role="alert">
                {shareError}
              </p>
            )}

            {receiptData.missingFields.length > 0 && !loading && (
              <p className="verification-gst-bill-hint text-muted text-sm mb-0" role="status">
                Incomplete receipt data: {receiptData.missingFields.join(', ')}.
              </p>
            )}
          </div>
        )}

        <h2 id="verification-receipt-title" className="sr-only">
          Wallet receipt for {record.serialNumber || 'device'}
        </h2>
      </div>
    </div>,
    document.body,
  );
};
