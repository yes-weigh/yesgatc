import React, { useEffect, useMemo, useState } from 'react';
import { IndianRupee, Loader2, Plus, RefreshCw, Wallet, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAppContext } from '../../context/AppContext';
import { WalletRazorpayRechargePanel } from '../../components/WalletRazorpayRechargePanel';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
} from '../../components/VerificationPhotoUploadSlot';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  hasPendingWalletTopUpDuplicate,
  subscribeRcWalletBalance,
  subscribeWalletLedger,
  submitWalletTopUpWithScreenshot,
} from '../../lib/rcWallet';
import { formatRcFeeAmount, DEFAULT_RC_FEES_STRUCTURE } from '../../lib/rcProfileFields';
import {
  collectWalletLedgerRecordIds,
  expandWalletLedgerForDisplay,
  fetchSiteCalibrationsByIds,
} from '../../lib/walletLedgerDisplay';
import {
  isRazorpayWalletRechargeMode,
  walletRechargeGrossInr,
} from '../../lib/razorpaySettings';
import { useRcScope } from '../../lib/roleScope';
import type { SiteCalibration, WalletLedgerEntry } from '../../types';

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
  const { products } = useAppContext();
  const { rcUid, isVct } = useRcScope();
  const { appSettings } = useAppSettings();
  const razorpayRecharge = isRazorpayWalletRechargeMode(appSettings);

  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [ledgerRecordsById, setLedgerRecordsById] = useState<Map<string, SiteCalibration>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [razorpayPanelOpen, setRazorpayPanelOpen] = useState(false);
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

  const parsedAmount = useMemo(() => Math.floor(Number(amount.trim())), [amount]);
  const minRecharge = appSettings.razorpayMinWalletRechargeInr;
  const grossPreview = useMemo(() => {
    if (!razorpayRecharge || !Number.isFinite(parsedAmount) || parsedAmount < minRecharge) {
      return null;
    }
    return walletRechargeGrossInr(parsedAmount, appSettings.razorpayServiceChargePercent);
  }, [razorpayRecharge, parsedAmount, minRecharge, appSettings.razorpayServiceChargePercent]);

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

  useEffect(() => {
    const recordIds = collectWalletLedgerRecordIds(ledger);
    if (recordIds.length === 0) {
      setLedgerRecordsById(new Map());
      return;
    }

    let cancelled = false;
    void fetchSiteCalibrationsByIds(recordIds).then(map => {
      if (!cancelled) setLedgerRecordsById(map);
    });

    return () => {
      cancelled = true;
    };
  }, [ledger]);

  const displayLedger = useMemo(
    () =>
      expandWalletLedgerForDisplay(
        ledger,
        ledgerRecordsById,
        products,
        DEFAULT_RC_FEES_STRUCTURE,
      ),
    [ledger, ledgerRecordsById, products],
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

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rcUid || !user) return;

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

  const handleRazorpayRecharge = () => {
    if (!rcUid || !user) return;
    setError('');
    setSuccess('');

    if (!Number.isFinite(parsedAmount) || parsedAmount < minRecharge) {
      setError(`Minimum wallet recharge is ₹${minRecharge}.`);
      return;
    }

    setRazorpayPanelOpen(true);
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
        razorpayRecharge ? (
          <div className="rc-wallet-form verification-evidence-panel rc-wallet-form--expanded">
            <header className="verification-evidence-panel-head">
              <span className="verification-evidence-panel-head-icon" aria-hidden>
                <IndianRupee size={14} strokeWidth={2.25} />
              </span>
              <div className="verification-evidence-panel-head-text">
                <h2 className="verification-evidence-panel-title">Add to wallet</h2>
                <p className="verification-evidence-panel-meta">
                  Enter the wallet amount to credit. Pay via Razorpay — your wallet is credited
                  instantly after payment ({appSettings.razorpayServiceChargePercent}% service charge
                  added at checkout).
                </p>
              </div>
            </header>

            <div className="rc-wallet-form-fields product-form-flat">
              <div className="form-group">
                <label htmlFor="wallet-amount">Wallet credit (INR)</label>
                <input
                  id="wallet-amount"
                  type="number"
                  min={minRecharge}
                  step="1"
                  className="input-field"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={`Min ₹${minRecharge}`}
                  disabled={submitting || razorpayPanelOpen}
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
                  placeholder="Internal note"
                  disabled={submitting || razorpayPanelOpen}
                />
              </div>
            </div>

            {grossPreview != null && (
              <p className="text-sm text-muted mb-3">
                You pay <strong>{formatRcFeeAmount(grossPreview)}</strong> at Razorpay → wallet credited{' '}
                <strong>{formatRcFeeAmount(parsedAmount)}</strong>.
              </p>
            )}

            {error ? <p className="form-error rc-wallet-form-feedback">{error}</p> : null}

            <div className="rc-wallet-form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || razorpayPanelOpen}
                onClick={() => handleRazorpayRecharge()}
              >
                {razorpayPanelOpen ? (
                  <>
                    <Loader2 size={18} className="spin" aria-hidden />
                    Payment in progress…
                  </>
                ) : (
                  'Pay via Razorpay'
                )}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="rc-wallet-form verification-evidence-panel rc-wallet-form--expanded"
            onSubmit={e => void handleManualSubmit(e)}
          >
            <header className="verification-evidence-panel-head">
              <span className="verification-evidence-panel-head-icon" aria-hidden>
                <IndianRupee size={14} strokeWidth={2.25} />
              </span>
              <div className="verification-evidence-panel-head-text">
                <h2 className="verification-evidence-panel-title">Add to wallet</h2>
                <p className="verification-evidence-panel-meta">
                  Enter the amount you paid to Interweighing Pvt Ltd and upload the payment
                  screenshot. Super Admin will approve it and credit your wallet.
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
        )
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
                  {displayLedger.map(row => {
                    const isCredit = row.amountInr >= 0;
                    const typeCell = row.detail ? `${row.typeLabel} · ${row.detail}` : row.typeLabel;
                    return (
                      <tr key={row.key}>
                        <td className="rc-wallet-transactions-table__date">
                          {formatWalletTransactionDate(row.entry.createdAt)}
                        </td>
                        <td>{typeCell}</td>
                        <td
                          className={`rc-wallet-transactions-table__amount rc-wallet-transactions-table__amount--${isCredit ? 'credit' : 'debit'}`}
                        >
                          {isCredit ? '+' : '−'}
                          {formatRcFeeAmount(Math.abs(row.amountInr)).replace('₹', '').trim()}
                        </td>
                        <td className="rc-wallet-transactions-table__amount">
                          {row.balanceAfterInr != null
                            ? formatRcFeeAmount(row.balanceAfterInr).replace('₹', '').trim()
                            : '—'}
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

      {razorpayPanelOpen && parsedAmount >= minRecharge ? (
        <WalletRazorpayRechargePanel
          walletCreditInr={parsedAmount}
          serviceChargePercent={appSettings.razorpayServiceChargePercent}
          note={note}
          onPaid={async () => {
            setRazorpayPanelOpen(false);
            setShowAddForm(false);
            resetAddForm();
            setSuccess(`Wallet credited ${formatRcFeeAmount(parsedAmount)}.`);
          }}
          onClose={() => setRazorpayPanelOpen(false)}
        />
      ) : null}

    </div>
  );
};
