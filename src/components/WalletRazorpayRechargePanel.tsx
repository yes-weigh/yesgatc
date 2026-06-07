import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, IndianRupee, Loader2, X } from 'lucide-react';
import { formatRcFeeAmount } from '../lib/rcProfileFields';
import {
  createWalletTopUpOrder,
  getWalletTopUpPaymentStatus,
  openWalletTopUpCheckout,
  verifyWalletTopUpPayment,
  type WalletTopUpOrderSession,
} from '../lib/razorpayWalletTopUp';
import { walletRechargeGrossInr } from '../lib/razorpaySettings';

type WalletRazorpayRechargePanelProps = {
  walletCreditInr: number;
  serviceChargePercent: number;
  note?: string;
  onPaid: (result: { topUpId?: string; balanceInr?: number }) => void | Promise<void>;
  onClose: () => void;
};

type PanelPhase = 'loading' | 'awaiting' | 'verifying' | 'paid' | 'error';

function callableErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const record = err as { message?: string };
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
  }
  return 'Could not start payment.';
}

export const WalletRazorpayRechargePanel: React.FC<WalletRazorpayRechargePanelProps> = ({
  walletCreditInr,
  serviceChargePercent,
  note,
  onPaid,
  onClose,
}) => {
  const [phase, setPhase] = useState<PanelPhase>('loading');
  const [session, setSession] = useState<WalletTopUpOrderSession | null>(null);
  const [error, setError] = useState('');
  const [statusHint, setStatusHint] = useState('Opening Razorpay…');
  const paidRef = useRef(false);

  const grossAmountInr = walletRechargeGrossInr(walletCreditInr, serviceChargePercent);

  const completePayment = useCallback(async (result: { topUpId?: string; balanceInr?: number }) => {
    if (paidRef.current) return;
    paidRef.current = true;
    setPhase('paid');
    setStatusHint('Payment received. Wallet credited.');
    await onPaid(result);
  }, [onPaid]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const created = await createWalletTopUpOrder({
          walletCreditInr,
          note,
        });
        if (cancelled) return;
        if (!created.configured) {
          setError(
            'Razorpay is not configured on the server. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Cloud Functions.',
          );
          setPhase('error');
          return;
        }
        setSession(created);
        setPhase('awaiting');
        setStatusHint('Pay via UPI or card to credit your wallet.');
      } catch (err) {
        if (cancelled) return;
        setError(callableErrorMessage(err));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletCreditInr, note]);

  useEffect(() => {
    if (!session || phase !== 'awaiting') return;

    const poll = window.setInterval(async () => {
      try {
        const status = await getWalletTopUpPaymentStatus(session.orderId);
        if (status.status === 'paid') {
          window.clearInterval(poll);
          await completePayment({
            topUpId: status.topUpId,
            balanceInr: status.balanceInr,
          });
        }
      } catch {
        // Webhook may arrive shortly after UPI confirmation.
      }
    }, 4000);

    return () => window.clearInterval(poll);
  }, [session, phase, completePayment]);

  const handleCheckout = async () => {
    if (!session) return;
    setError('');
    setStatusHint('Complete payment in your UPI app…');
    try {
      const response = await openWalletTopUpCheckout(session, {
        description: `Wallet ₹${walletCreditInr} (+ ${serviceChargePercent}% service charge)`,
      });
      setPhase('verifying');
      const status = await verifyWalletTopUpPayment({
        orderId: session.orderId,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });
      if (status.status === 'paid') {
        await completePayment({
          topUpId: status.topUpId,
          balanceInr: status.balanceInr,
        });
        return;
      }
      setPhase('awaiting');
      setStatusHint('Payment submitted. Confirming with bank…');
    } catch (err) {
      if (err instanceof Error && err.message === 'Payment cancelled.') {
        setStatusHint('Payment cancelled. Try again when ready.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  const content = (
    <div className="rv-payment-overlay" role="dialog" aria-modal="true" aria-labelledby="wallet-recharge-title">
      <button type="button" className="rv-payment-overlay-dismiss" onClick={onClose} aria-label="Close payment" />
      <div className="rv-payment-panel">
        <div className="rv-payment-panel-head">
          <div className="rv-payment-panel-head-main">
            <IndianRupee size={18} aria-hidden />
            <h2 id="wallet-recharge-title" className="rv-payment-panel-title mb-0">
              Wallet recharge
            </h2>
          </div>
          <button type="button" className="btn-icon rv-payment-panel-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="rv-payment-panel-lead mb-0">
          Your wallet will be credited {formatRcFeeAmount(walletCreditInr)}. You pay{' '}
          {formatRcFeeAmount(grossAmountInr)} at Razorpay ({serviceChargePercent}% service charge).
        </p>

        <div className="rv-payment-breakdown">
          <div className="rv-payment-breakdown-row">
            <span>Wallet credit</span>
            <strong>{formatRcFeeAmount(walletCreditInr)}</strong>
          </div>
          <div className="rv-payment-breakdown-row">
            <span>Service charge ({serviceChargePercent}%)</span>
            <strong>{formatRcFeeAmount(grossAmountInr - walletCreditInr)}</strong>
          </div>
          <div className="rv-payment-breakdown-row rv-payment-breakdown-row--total">
            <span>Pay at Razorpay</span>
            <strong>{formatRcFeeAmount(grossAmountInr)}</strong>
          </div>
        </div>

        {phase === 'loading' && (
          <p className="rv-payment-status-hint">
            <Loader2 size={16} className="spin" aria-hidden />
            {statusHint}
          </p>
        )}

        {phase === 'awaiting' && session && (
          <>
            <p className="rv-payment-status-hint">{statusHint}</p>
            <button type="button" className="btn btn-primary rv-payment-checkout-btn" onClick={() => void handleCheckout()}>
              <CreditCard size={18} aria-hidden />
              Pay {formatRcFeeAmount(grossAmountInr)} via Razorpay
            </button>
          </>
        )}

        {phase === 'verifying' && (
          <p className="rv-payment-status-hint">
            <Loader2 size={16} className="spin" aria-hidden />
            Verifying payment…
          </p>
        )}

        {phase === 'paid' && (
          <p className="rv-payment-status-hint text-success">{statusHint}</p>
        )}

        {phase === 'error' && error ? (
          <p className="form-error rv-payment-form-error">{error}</p>
        ) : null}

        {error && phase === 'awaiting' ? (
          <p className="form-error rv-payment-form-error">{error}</p>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
