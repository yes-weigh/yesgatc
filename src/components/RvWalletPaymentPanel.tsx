import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IndianRupee, Wallet, X } from 'lucide-react';
import { formatRcFeeAmount } from '../lib/rcProfileFields';
import { fetchRcWalletBalance, payRvFromWallet } from '../lib/rcWallet';
import type { RvPaymentBreakdown } from '../lib/rvPaymentAmount';

type RvWalletPaymentPanelProps = {
  breakdown: RvPaymentBreakdown;
  rcId: string;
  recordIds?: string[];
  onPaid: (paymentId: string) => void | Promise<void>;
  onClose: () => void;
};

export const RvWalletPaymentPanel: React.FC<RvWalletPaymentPanelProps> = ({
  breakdown,
  rcId,
  recordIds,
  onPaid,
  onClose,
}) => {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await fetchRcWalletBalance(rcId);
        if (!cancelled) setBalance(value);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load wallet balance.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rcId]);

  const sufficient = balance != null && balance >= breakdown.total;

  const handlePay = async () => {
    setPaying(true);
    setError('');
    try {
      const result = await payRvFromWallet({
        rcId,
        amountInr: breakdown.total,
        recordIds,
      });
      setBalance(result.balanceInr);
      await onPaid(result.paymentId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Wallet payment failed.');
    } finally {
      setPaying(false);
    }
  };

  return createPortal(
    <div className="rv-payment-overlay" role="dialog" aria-modal="true" aria-label="Pay from wallet">
      <div className="rv-payment-panel glass">
        <header className="rv-payment-panel-head">
          <div className="rv-payment-panel-title-wrap">
            <Wallet size={20} aria-hidden />
            <h2 className="rv-payment-panel-title">Pay from wallet</h2>
          </div>
          <button type="button" className="rv-payment-panel-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="rv-payment-panel-body">
          <p className="text-muted text-sm mb-4">
            RV administrative fees will be debited from your prepaid wallet balance.
          </p>

          <div className="rv-wallet-payment-summary">
            <div className="rv-wallet-payment-row">
              <span>Available balance</span>
              <strong>
                {loading ? '…' : formatRcFeeAmount(balance ?? 0)}
              </strong>
            </div>
            <div className="rv-wallet-payment-row">
              <span>Amount due</span>
              <strong>{formatRcFeeAmount(breakdown.total)}</strong>
            </div>
            <div className="rv-wallet-payment-row rv-wallet-payment-row--total">
              <span>Balance after payment</span>
              <strong>
                {loading || balance == null
                  ? '…'
                  : formatRcFeeAmount(Math.max(0, balance - breakdown.total))}
              </strong>
            </div>
          </div>

          {!loading && balance != null && !sufficient && (
            <p className="form-error mt-3">
              Insufficient balance. Add a top-up from your dashboard wallet page and wait for Super Admin approval.
            </p>
          )}

          {error && <p className="form-error mt-3">{error}</p>}

          <div className="rv-payment-panel-actions mt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={paying}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handlePay()}
              disabled={paying || loading || !sufficient}
            >
              <IndianRupee size={16} aria-hidden />
              {paying ? 'Processing…' : 'Pay from wallet'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
