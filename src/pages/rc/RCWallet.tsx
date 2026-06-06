import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IndianRupee, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { StorageImage } from '../../components/StorageImage';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
} from '../../components/VerificationPhotoUploadSlot';
import {
  fetchRcWalletBalance,
  fetchWalletTopUps,
  submitWalletTopUpWithScreenshot,
  walletTopUpStatusLabel,
} from '../../lib/rcWallet';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import { useRcScope } from '../../lib/roleScope';
import type { WalletTopUp } from '../../types';

export const RCWallet: React.FC = () => {
  const { user } = useAuth();
  const { rcUid } = useRcScope();
  const [balance, setBalance] = useState(0);
  const [topUps, setTopUps] = useState<WalletTopUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const refresh = useCallback(async () => {
    if (!rcUid) return;
    setLoading(true);
    try {
      const [walletBalance, rows] = await Promise.all([
        fetchRcWalletBalance(rcUid),
        fetchWalletTopUps({ rcId: rcUid }),
      ]);
      setBalance(walletBalance);
      setTopUps(rows);
    } finally {
      setLoading(false);
    }
  }, [rcUid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rcUid || !user) return;

    const amountInr = Number(amount.trim());
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
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
      await submitWalletTopUpWithScreenshot({
        amountInr,
        note,
        file: screenshotFile,
        onProgress: pct => setUploadProgress(pct),
      });
      setUploading(false);

      setAmount('');
      setNote('');
      handleScreenshotRemove();
      setSuccess('Top-up submitted. Super Admin will review your payment screenshot.');
      await refresh();
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
        <div className="rc-kpi-card__top">
          <div className="rc-kpi-card__icon">
            <Wallet size={22} />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm rc-wallet-refresh"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden />
            Refresh
          </button>
        </div>
        <div className="rc-kpi-card__body">
          <p className="rc-kpi-card__label">Available balance</p>
          {loading ? (
            <span className="rc-kpi-card__skeleton" aria-hidden="true" />
          ) : (
            <p className="rc-kpi-card__value">
              <IndianRupee size={18} className="inline-icon" aria-hidden />
              {formatRcFeeAmount(balance).replace('₹', '').trim()}
            </p>
          )}
          <p className="rc-kpi-card__sub">
            Use wallet balance for RV verification fees when wallet payments are enabled.
          </p>
        </div>
      </section>

      <div className="rc-wallet-layout">
        <form
          className="rc-wallet-form verification-evidence-panel"
          onSubmit={e => void handleSubmit(e)}
        >
          <header className="verification-evidence-panel-head">
            <span className="verification-evidence-panel-head-icon" aria-hidden>
              <IndianRupee size={14} strokeWidth={2.25} />
            </span>
            <div className="verification-evidence-panel-head-text">
              <h2 className="verification-evidence-panel-title">Add payment</h2>
              <p className="verification-evidence-panel-meta">
                Transfer fees to the designated account, then upload the payment screenshot here.
                Super Admin will approve it and credit your wallet.
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
          {success ? <p className="rc-wallet-form-success rc-wallet-form-feedback">{success}</p> : null}

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

        <aside className="rc-wallet-history verification-evidence-panel">
          <header className="verification-evidence-panel-head">
            <div className="verification-evidence-panel-head-text">
              <h2 className="verification-evidence-panel-title">Top-up history</h2>
              <p className="verification-evidence-panel-meta">
                Pending requests until Super Admin approves or rejects.
              </p>
            </div>
          </header>

          {loading ? (
            <div className="rc-wallet-history-loading">
              <span className="spinner-inline" aria-label="Loading" />
            </div>
          ) : topUps.length === 0 ? (
            <p className="rc-wallet-history-empty">No top-ups yet.</p>
          ) : (
            <ul className="rc-wallet-history-list">
              {topUps.map(item => (
                <li key={item.id} className="rc-wallet-history-item">
                  <div className="rc-wallet-history-item-head">
                    <div>
                      <p className="rc-wallet-history-amount">{formatRcFeeAmount(item.amountInr)}</p>
                      <p className="rc-wallet-history-date">
                        {new Date(item.submittedAt).toLocaleString()}
                      </p>
                      {item.note ? <p className="rc-wallet-history-note">{item.note}</p> : null}
                      {item.status === 'rejected' && item.rejectionReason ? (
                        <p className="rc-wallet-history-reject">{item.rejectionReason}</p>
                      ) : null}
                    </div>
                    <span className={`rc-wallet-status rc-wallet-status--${item.status}`}>
                      {walletTopUpStatusLabel(item.status)}
                    </span>
                  </div>
                  {item.screenshotUrl || item.screenshotPath ? (
                    <div className="rc-wallet-history-thumb">
                      <StorageImage
                        url={item.screenshotUrl}
                        path={item.screenshotPath}
                        alt="Payment screenshot"
                        className="rc-wallet-history-img"
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
};
