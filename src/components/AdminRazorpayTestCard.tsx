import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, ExternalLink, Globe, Loader2, Play } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  createWalletTopUpOrder,
  getWalletTopUpPaymentStatus,
  openWalletTopUpCheckout,
  verifyWalletTopUpPayment,
  type WalletTopUpOrderSession,
} from '../lib/razorpayWalletTopUp';

type AdminRazorpayTestCardProps = {
  className?: string;
};

type TestPhase = 'idle' | 'loading' | 'awaiting' | 'verifying' | 'paid' | 'error';

export const AdminRazorpayTestCard: React.FC<AdminRazorpayTestCardProps> = ({ className = '' }) => {
  const [testOpen, setTestOpen] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [session, setSession] = useState<WalletTopUpOrderSession | null>(null);
  const [error, setError] = useState('');
  const paidRef = useRef(false);

  const siteHost = useMemo(
    () => (typeof window !== 'undefined' ? window.location.host : ''),
    [],
  );

  const completeTest = useCallback(() => {
    if (paidRef.current) return;
    paidRef.current = true;
    setPhase('paid');
    setLastSuccess(
      'Razorpay test payment succeeded — keys, order API, checkout, and site whitelist look good.',
    );
    setTestOpen(false);
  }, []);

  useEffect(() => {
    if (!testOpen) return;
    paidRef.current = false;
    setPhase('loading');
    setError('');
    setSession(null);

    let cancelled = false;
    (async () => {
      try {
        const created = await createWalletTopUpOrder({ walletCreditInr: 1, testMode: true });
        if (cancelled) return;
        if (!created.configured) {
          setError('Razorpay is not configured on the server.');
          setPhase('error');
          return;
        }
        setSession(created);
        setPhase('awaiting');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not start test payment.');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [testOpen]);

  useEffect(() => {
    if (!session || phase !== 'awaiting') return;
    const poll = window.setInterval(async () => {
      try {
        const status = await getWalletTopUpPaymentStatus(session.orderId);
        if (status.status === 'paid') {
          window.clearInterval(poll);
          completeTest();
        }
      } catch {
        // ignore
      }
    }, 4000);
    return () => window.clearInterval(poll);
  }, [session, phase, completeTest]);

  const handleCheckout = async () => {
    if (!session) return;
    setError('');
    try {
      const response = await openWalletTopUpCheckout(session, {
        description: 'Razorpay integration test (₹1)',
      });
      setPhase('verifying');
      const status = await verifyWalletTopUpPayment({
        orderId: session.orderId,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });
      if (status.status === 'paid') {
        completeTest();
        return;
      }
      setPhase('awaiting');
    } catch (err) {
      if (err instanceof Error && err.message === 'Payment cancelled.') return;
      setError(err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  const overlay = testOpen ? (
    <div className="rv-payment-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="rv-payment-overlay-dismiss"
        onClick={() => setTestOpen(false)}
        aria-label="Close test"
      />
      <div className="rv-payment-panel">
        <h2 className="rv-payment-panel-title">Test Razorpay gateway</h2>
        <p className="rv-payment-panel-lead mb-0">
          Run a ₹1 test order. No wallet balance is credited.
        </p>
        {phase === 'loading' && (
          <p className="rv-payment-status-hint">
            <Loader2 size={16} className="spin" aria-hidden />
            Creating test order…
          </p>
        )}
        {phase === 'awaiting' && session && (
          <button type="button" className="btn btn-primary mt-4" onClick={() => void handleCheckout()}>
            <CreditCard size={18} aria-hidden />
            Pay ₹1 via Razorpay
          </button>
        )}
        {phase === 'verifying' && (
          <p className="rv-payment-status-hint">
            <Loader2 size={16} className="spin" aria-hidden />
            Verifying…
          </p>
        )}
        {error ? <p className="form-error mt-3">{error}</p> : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className={`panel glass mt-6 admin-razorpay-test-card${className ? ` ${className}` : ''}`}>
        <div className="panel-header">
          <h2>
            <CreditCard className="inline-icon" /> Razorpay integration test
          </h2>
        </div>
        <div className="panel-body">
          <div className="admin-razorpay-test-whitelist">
            <div className="admin-razorpay-test-whitelist-head">
              <Globe size={16} aria-hidden />
              <span>Site host</span>
            </div>
            <p className="admin-razorpay-test-whitelist-host mb-0">
              <code>{siteHost || '—'}</code>
            </p>
            <a
              href="https://dashboard.razorpay.com/app/website-app-settings/websites"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-razorpay-test-dashboard-link"
            >
              Open Razorpay website settings
              <ExternalLink size={14} aria-hidden />
            </a>
          </div>

          {lastSuccess ? (
            <p className="admin-razorpay-test-success mb-4" role="status">
              <CheckCircle2 size={16} aria-hidden />
              {lastSuccess}
            </p>
          ) : null}

          <button
            type="button"
            className="btn btn-primary admin-razorpay-test-btn"
            onClick={() => {
              setLastSuccess(null);
              setTestOpen(true);
            }}
          >
            <Play size={16} aria-hidden />
            Test payment gateway
          </button>
        </div>
      </div>

      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
};
