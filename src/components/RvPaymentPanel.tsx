import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, IndianRupee, QrCode, Smartphone, X } from 'lucide-react';
import { formatRcFeeAmount } from '../lib/rcProfileFields';
import type { RvPaymentBreakdown } from '../lib/rvPaymentAmount';
import {
  createRvPaymentOrder,
  getRvPaymentStatus,
  isRazorpayConfigured,
  openRazorpayCheckout,
  verifyRvPayment,
  type RvPaymentSession,
} from '../lib/razorpayRvPayment';

type RvPaymentPanelProps = {
  breakdown: RvPaymentBreakdown;
  rcId: string;
  recordIds?: string[];
  onPaid: (paymentId: string) => void | Promise<void>;
  onClose: () => void;
};

type PanelPhase = 'loading' | 'awaiting' | 'verifying' | 'paid' | 'error';

function callableErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const record = err as { message?: string; details?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
  }
  return 'Could not start payment.';
}

function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const onChange = () => setMobile(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return mobile;
}

export const RvPaymentPanel: React.FC<RvPaymentPanelProps> = ({
  breakdown,
  rcId,
  recordIds,
  onPaid,
  onClose,
}) => {
  const isMobile = useIsMobileViewport();
  const [phase, setPhase] = useState<PanelPhase>('loading');
  const [session, setSession] = useState<RvPaymentSession | null>(null);
  const [error, setError] = useState('');
  const [statusHint, setStatusHint] = useState('Waiting for payment…');
  const paidRef = useRef(false);

  const completePayment = useCallback(async (paymentId: string) => {
    if (paidRef.current) return;
    paidRef.current = true;
    setPhase('paid');
    setStatusHint('Payment received. Submitting verification…');
    await onPaid(paymentId);
  }, [onPaid]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const created = await createRvPaymentOrder({
          amountInr: breakdown.total,
          rcId,
          recordIds,
          breakdown,
        });
        if (cancelled) return;
        if (!created.configured) {
          setError('Razorpay is not configured on the server. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Cloud Functions.');
          setPhase('error');
          return;
        }
        setSession(created);
        setPhase('awaiting');
      } catch (err) {
        if (cancelled) return;
        setError(callableErrorMessage(err));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [breakdown, rcId, recordIds]);

  useEffect(() => {
    if (!session || phase !== 'awaiting') return;

    const poll = window.setInterval(async () => {
      try {
        const status = await getRvPaymentStatus(session.paymentId);
        if (status.status === 'paid') {
          window.clearInterval(poll);
          await completePayment(session.paymentId);
        }
      } catch {
        // Keep polling — webhook may arrive shortly after UPI confirmation.
      }
    }, 4000);

    return () => window.clearInterval(poll);
  }, [session, phase, completePayment]);

  const handleUpiCheckout = async () => {
    if (!session) return;
    setError('');
    setStatusHint('Complete payment in your UPI app…');
    try {
      const response = await openRazorpayCheckout(session);
      setPhase('verifying');
      const status = await verifyRvPayment({
        paymentId: session.paymentId,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });
      if (status.status === 'paid') {
        await completePayment(session.paymentId);
        return;
      }
      setPhase('awaiting');
      setStatusHint('Payment submitted. Confirming with bank…');
    } catch (err) {
      if (err instanceof Error && err.message === 'Payment cancelled.') {
        setStatusHint('Payment cancelled. Scan the QR or try UPI again.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  const showQr = useMemo(
    () => Boolean(session?.qrImageUrl) && !isMobile,
    [session?.qrImageUrl, isMobile],
  );

  const content = (
    <div className="rv-payment-overlay" role="dialog" aria-modal="true" aria-labelledby="rv-payment-title">
      <button type="button" className="rv-payment-overlay-dismiss" onClick={onClose} aria-label="Close payment" />
      <div className="rv-payment-panel">
        <div className="rv-payment-panel-head">
          <div className="rv-payment-panel-head-main">
            <IndianRupee size={18} aria-hidden />
            <h2 id="rv-payment-title" className="rv-payment-panel-title mb-0">RV payment</h2>
          </div>
          <button type="button" className="btn-icon rv-payment-panel-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="rv-payment-panel-lead mb-0">
          Pay administrative fees and GST before submitting for certification.
        </p>

        <div className="rv-payment-breakdown">
          <div className="rv-payment-breakdown-line">
            <span>Administrative fees</span>
            <span>{formatRcFeeAmount(breakdown.administrativeFees)}</span>
          </div>
          <div className="rv-payment-breakdown-line rv-payment-breakdown-line--detail">
            <span>TDS</span>
            <span>{formatRcFeeAmount(breakdown.tdsTotal)}</span>
          </div>
          <div className="rv-payment-breakdown-line rv-payment-breakdown-line--detail">
            <span>Gateway</span>
            <span>{formatRcFeeAmount(breakdown.gatewayTotal)}</span>
          </div>
          <div className="rv-payment-breakdown-line rv-payment-breakdown-line--section">
            <span>GST (18%)</span>
            <span>{formatRcFeeAmount(breakdown.gst)}</span>
          </div>
          <div className="rv-payment-breakdown-line rv-payment-breakdown-line--total">
            <span>Amount to pay</span>
            <strong>{formatRcFeeAmount(breakdown.total)}</strong>
          </div>
        </div>

        {phase === 'loading' && (
          <div className="rv-payment-status">
            <span className="spinner-inline" aria-hidden />
            <span>Preparing Razorpay payment…</span>
          </div>
        )}

        {phase === 'error' && (
          <p className="rv-payment-error mb-0" role="alert">
            {error || 'Payment could not be started.'}
          </p>
        )}

        {(phase === 'awaiting' || phase === 'verifying' || phase === 'paid') && session && (
          <div className="rv-payment-methods">
            {showQr && (
              <div className="rv-payment-qr-block">
                <div className="rv-payment-method-label">
                  <QrCode size={15} aria-hidden />
                  <span>Scan with any UPI app</span>
                </div>
                <img
                  className="rv-payment-qr-image"
                  src={session.qrImageUrl!}
                  alt={`UPI QR code for ${formatRcFeeAmount(breakdown.total)}`}
                />
              </div>
            )}

            <div className="rv-payment-upi-block">
              <div className="rv-payment-method-label">
                <Smartphone size={15} aria-hidden />
                <span>{isMobile ? 'Pay on this phone' : 'Or pay with UPI on this device'}</span>
              </div>
              <button
                type="button"
                className="btn btn-primary rv-payment-upi-btn"
                onClick={() => void handleUpiCheckout()}
                disabled={phase === 'verifying' || phase === 'paid' || !isRazorpayConfigured()}
              >
                <CreditCard size={16} aria-hidden />
                Pay {formatRcFeeAmount(breakdown.total)} with UPI
              </button>
              {!isRazorpayConfigured() && (
                <p className="rv-payment-config-hint mb-0">
                  Add <code>VITE_RAZORPAY_KEY_ID</code> to your Vite env for checkout on this device.
                </p>
              )}
            </div>

            <p className="rv-payment-status-hint mb-0" role="status">
              {phase === 'paid' ? statusHint : phase === 'verifying' ? 'Verifying payment…' : statusHint}
            </p>
            {error && (
              <p className="rv-payment-error mb-0" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
