import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, IndianRupee, Loader2, Plus, RefreshCw, Wallet, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
} from '../../components/VerificationPhotoUploadSlot';
import {
  hasPendingWalletTopUpDuplicate,
  subscribeRcWalletBalance,
  subscribeWalletLedger,
  submitWalletTopUpWithScreenshot,
  walletLedgerTypeLabel,
} from '../../lib/rcWallet';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import { buildWalletUpiPayUrl, parseWalletTopUpAmountInput } from '../../lib/walletUpiPay';
import { useRcScope } from '../../lib/roleScope';
import type { WalletLedgerEntry } from '../../types';

const TRANSACTIONS_LIMIT = 25;

function formatWalletTransactionDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const RCWallet: React.FC = () => {
  const { user } = useAuth();
  const { rcUid, isVct } = useRcScope();
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [initialLoadDone, setInitialLoadDone] = useState(false);

  useEffect(() => {
    if (!rcUid) {
      setBalance(0);
      setLedger([]);
      setLoading(false);
      setInitialLoadDone(false);
      return;
    }

    setLoading(true);
    setInitialLoadDone(false);

    const unsubBalance = subscribeRcWalletBalance(
      rcUid,
      value => {
        setBalance(value);
        setInitialLoadDone(true);
        setLoading(false);
      },
      err => setError(err.message),
    );

    const unsubLedger = subscribeWalletLedger(
      { rcId: rcUid, limit: TRANSACTIONS_LIMIT },
      rows => {
        setLedger(rows);
        setInitialLoadDone(true);
        setLoading(false);
      },
      err => setError(err.message),
    );

    return () => {
      unsubBalance();
      unsubLedger();
    };
  }, [rcUid]);

  const amountInr = useMemo(() => parseWalletTopUpAmountInput(amount), [amount]);

  const upiPayUrl = useMemo(
    () => (amountInr != null ? buildWalletUpiPayUrl(amountInr, note) : null),
    [amountInr, note],
  );

  const screenshotMeta = useMemo(
    () =>
      screenshotPreview
        ? {
            url: screenshotPreview,
            path: '',
            name: screenshotFile?.name || 'screenshot',
            contentType: screenshotFile?.type || 'image/jpeg',
          }
        : null,
    [screenshotPreview, screenshotFile],
  );

  const handleScreenshotSelect = (file: File) => {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotFile(file);
    setScreenshotPreview(URL.createObjectURL(file));
  };

  const handleScreenshotRemove = () => {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotFile(null);
    setScreenshotPreview(null);
  };

  const resetAddForm = () => {
    setAmount('');
    setNote('');
    handleScreenshotRemove();
    setError('');
    setSuccess('');
    setUploadProgress(0);
  };

  const closeAddForm = () => {
    if (submitting) return;
    setShowAddForm(false);
    resetAddForm();
  };

  const openAddForm = () => {
    resetAddForm();
    setShowAddForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rcUid || !user) return;

    const parsedAmount = Number(amount.trim());
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a valid payment amount.');
      return;
    }
    if (!screenshotFile) {
      setError('Upload a screenshot of the payment you made.');
      return;
    }

    setSubmitting(true);
    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const duplicatePending = await hasPendingWalletTopUpDuplicate(rcUid, parsedAmount);
      if (duplicatePending) {
        setError(
          'You already have a pending top-up for this amount. Wait for Super Admin review or submit a different amount.',
        );
        setSubmitting(false);
        setUploading(false);
        setUploadProgress(0);
        return;
      }

      await submitWalletTopUpWithScreenshot({
        amountInr: parsedAmount,
        note,
        file: screenshotFile,
        onProgress: pct => setUploadProgress(pct),
      });
      setUploading(false);
      resetAddForm();
      setShowAddForm(false);
      setSuccess('Top-up submitted. Super Admin will review your payment screenshot.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not submit top-up.');
    } finally {
      setSubmitting(false);
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="fade-in rc-wallet-page">
      <section className="rc-wallet-balance rc-kpi-card rc-kpi-card--violet" aria-label="Wallet balance">
        <div className="rc-kpi-card__glow" aria-hidden="true" />
        <div className="rc-kpi-card__top rc-wallet-balance__top">
          <div className="rc-kpi-card__icon">
            <Wallet size={22} />
          </div>
          <div className="rc-wallet-balance__actions">
            <span className="rc-wallet-live-badge" title="Balance and history update automatically">
              <RefreshCw size={12} aria-hidden />
              Live
            </span>
            {showAddForm ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm rc-wallet-add-btn"
                onClick={closeAddForm}
                disabled={submitting}
              >
                <X size={16} aria-hidden />
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm rc-wallet-add-btn"
                onClick={openAddForm}
              >
                <Plus size={16} aria-hidden />
                Add to wallet
              </button>
            )}
          </div>
        </div>
        <div className="rc-kpi-card__body">
          <p className="rc-kpi-card__label">Available balance</p>
          {loading && !initialLoadDone ? (
            <span className="rc-kpi-card__skeleton" aria-hidden="true" />
          ) : (
            <p className="rc-kpi-card__value">
              <IndianRupee size={18} className="inline-icon" aria-hidden />
              {formatRcFeeAmount(balance).replace('₹', '').trim()}
            </p>
          )}
          <p className="rc-kpi-card__sub">
            {isVct
              ? 'Shared RC centre wallet — use for RV verification fees when wallet payments are enabled.'
              : 'Use wallet balance for RV verification fees when wallet payments are enabled.'}
          </p>
        </div>
      </section>

      {success && !showAddForm ? (
        <p className="rc-wallet-page-success" role="status">
          {success}
        </p>
      ) : null}

      {showAddForm ? (
        <form
          className="rc-wallet-form verification-evidence-panel rc-wallet-form--expanded"
          onSubmit={e => void handleSubmit(e)}
        >
          <header className="verification-evidence-panel-head">
            <span className="verification-evidence-panel-head-icon" aria-hidden>
              <IndianRupee size={14} strokeWidth={2.25} />
            </span>
            <div className="verification-evidence-panel-head-text">
              <h2 className="verification-evidence-panel-title">Add to wallet</h2>
              <p className="verification-evidence-panel-meta">
                Enter the amount, pay via UPI to Interweighing Pvt Ltd, then upload the payment
                screenshot here. Super Admin will approve it and credit your wallet.
              </p>
            </div>
          </header>

          <div className="rc-wallet-form-fields product-form-flat">
            <div className="form-group">
              <label htmlFor="wallet-amount">Amount paid (INR)</label>
              <input
                id="wallet-amount"
                type="number"
                min="1"
                step="0.01"
                className="input-field"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="e.g. 5000"
                disabled={submitting}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="wallet-note">Reference / note (optional)</label>
              <input
                id="wallet-note"
                type="text"
                className="input-field"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="UPI ref, bank transfer ID, etc."
                disabled={submitting}
              />
            </div>
          </div>

          <div className="rc-wallet-upi-step">
            <div className="rc-wallet-upi-step__copy">
              <p className="rc-wallet-upi-step__title">Step 1 — Pay via UPI</p>
              <p className="rc-wallet-upi-step__meta">
                Opens your UPI app with{' '}
                {amountInr != null ? formatRcFeeAmount(amountInr) : 'the amount above'} pre-filled for
                Interweighing Pvt Ltd.
              </p>
            </div>
            {upiPayUrl ? (
              <a
                href={upiPayUrl}
                className="btn btn-primary rc-wallet-upi-btn"
                onClick={() => setError('')}
              >
                <ExternalLink size={16} aria-hidden />
                Pay via UPI app
              </a>
            ) : (
              <button type="button" className="btn btn-primary rc-wallet-upi-btn" disabled>
                <ExternalLink size={16} aria-hidden />
                Pay via UPI app
              </button>
            )}
          </div>

          <VerificationPhotoUploadSection title="Payment screenshot" columns={2}>
            <VerificationPhotoUploadSlot
              slotKey="payment-screenshot"
              label="Payment screenshot"
              required
              file={screenshotMeta}
              uploading={uploading}
              progress={uploadProgress}
              accept="image/jpeg,image/png,image/webp"
              disabled={submitting}
              icon="document"
              allowCamera={false}
              onSelect={handleScreenshotSelect}
              onRemove={handleScreenshotRemove}
            />
          </VerificationPhotoUploadSection>

          {error ? <p className="form-error rc-wallet-form-feedback">{error}</p> : null}

          <div className="rc-wallet-form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={18} className="spin" aria-hidden />
                  Submitting…
                </>
              ) : (
                'Submit for approval'
              )}
            </button>
          </div>
        </form>
      ) : (
        <section className="rc-wallet-transactions verification-evidence-panel" aria-label="Wallet transactions">
          <header className="verification-evidence-panel-head">
            <div className="verification-evidence-panel-head-text">
              <h2 className="verification-evidence-panel-title">Latest transactions</h2>
              <p className="verification-evidence-panel-meta">
                Credits, RV payments, and refunds on your wallet (newest first).
              </p>
            </div>
          </header>

          {loading && !initialLoadDone ? (
            <div className="rc-wallet-history-loading">
              <span className="spinner-inline" aria-label="Loading" />
            </div>
          ) : ledger.length === 0 ? (
            <p className="rc-wallet-history-empty">No wallet transactions yet.</p>
          ) : (
            <div className="rc-wallet-transactions-table-wrap">
              <table className="rc-wallet-transactions-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="rc-wallet-transactions-table__amount">
                      Amount
                    </th>
                    <th scope="col" className="rc-wallet-transactions-table__amount">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map(entry => {
                    const isCredit = entry.amountInr >= 0;
                    return (
                      <tr key={entry.id}>
                        <td className="rc-wallet-transactions-table__date">
                          {formatWalletTransactionDate(entry.createdAt)}
                        </td>
                        <td>{walletLedgerTypeLabel(entry.type)}</td>
                        <td
                          className={`rc-wallet-transactions-table__amount rc-wallet-transactions-table__amount--${isCredit ? 'credit' : 'debit'}`}
                        >
                          {isCredit ? '+' : '−'}
                          {formatRcFeeAmount(Math.abs(entry.amountInr)).replace('₹', '').trim()}
                        </td>
                        <td className="rc-wallet-transactions-table__amount">
                          {formatRcFeeAmount(entry.balanceAfterInr).replace('₹', '').trim()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
