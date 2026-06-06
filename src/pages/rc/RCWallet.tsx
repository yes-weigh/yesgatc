import React, { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { StorageImage } from '../../components/StorageImage';
import { UploadField } from '../admin/productFormUi';
import {
  createWalletTopUpRequest,
  fetchRcWalletBalance,
  fetchWalletTopUps,
  walletTopUpStatusLabel,
} from '../../lib/rcWallet';
import { uploadWalletTopUpScreenshot } from '../../lib/walletTopUpUpload';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import { useRcScope } from '../../lib/roleScope';
import type { WalletTopUp } from '../../types';
import { IndianRupee, RefreshCw, Wallet } from 'lucide-react';

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
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshotFile(file);
    setScreenshotPreview(URL.createObjectURL(file));
    e.target.value = '';
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

    const topUpId = crypto.randomUUID();

    try {
      const screenshot = await uploadWalletTopUpScreenshot(
        topUpId,
        screenshotFile,
        pct => setUploadProgress(pct),
      );
      setUploading(false);

      const profileSnap = await getDoc(doc(db, 'users', rcUid));
      const profile = profileSnap.data() as { companyName?: string; username?: string } | undefined;

      await createWalletTopUpRequest({
        id: topUpId,
        rcId: rcUid,
        rcCompanyName: profile?.companyName || profile?.username,
        amountInr,
        screenshot,
        note,
        submittedByUid: user.uid,
      });

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
      <section className="rc-wallet-hero panel glass">
        <div className="rc-wallet-hero__icon" aria-hidden>
          <Wallet size={28} />
        </div>
        <div>
          <p className="rc-wallet-hero__label">Available balance</p>
          <p className="rc-wallet-hero__value">
            {loading ? '…' : formatRcFeeAmount(balance)}
          </p>
          <p className="text-muted text-sm mb-0">
            Use wallet balance for RV verification fees when wallet payments are enabled.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
          <RefreshCw size={14} aria-hidden /> Refresh
        </button>
      </section>

      <div className="grid-2 mt-6 rc-wallet-grid">
        <form className="panel glass" onSubmit={e => void handleSubmit(e)}>
          <div className="panel-header">
            <h2><IndianRupee className="inline-icon" /> Add payment</h2>
          </div>
          <div className="panel-body">
            <p className="text-muted text-sm mb-4">
              Transfer fees to the designated account, then upload the payment screenshot here.
              Super Admin will approve it and credit your wallet.
            </p>

            <div className="form-group">
              <label htmlFor="wallet-amount">Amount paid (INR)</label>
              <input
                id="wallet-amount"
                type="number"
                min="1"
                step="0.01"
                className="form-input"
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
                className="form-input"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="UPI ref, bank transfer ID, etc."
                disabled={submitting}
              />
            </div>

            <UploadField
              label="Payment screenshot"
              hint="Required — bank/UPI confirmation screenshot"
              file={
                screenshotPreview
                  ? { url: screenshotPreview, path: '', name: screenshotFile?.name || 'screenshot', contentType: screenshotFile?.type || 'image/jpeg' }
                  : null
              }
              uploading={uploading}
              progress={uploadProgress}
              accept="image/jpeg,image/png,image/webp"
              uploadLabel="Upload screenshot"
              formats="JPEG, PNG or WebP · max 15 MB"
              inputRef={inputRef}
              onSelect={handleScreenshotSelect}
              onRemove={handleScreenshotRemove}
              submitting={submitting}
              variant="image"
              compact
            />

            {error && <p className="form-error mt-3">{error}</p>}
            {success && <p className="text-green text-sm mt-3 mb-0">{success}</p>}

            <button type="submit" className="btn btn-primary mt-4" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </form>

        <div className="panel glass">
          <div className="panel-header">
            <h2>Top-up history</h2>
          </div>
          <div className="panel-body p-0">
            {loading ? (
              <div className="text-center py-8"><span className="spinner-inline" /></div>
            ) : topUps.length === 0 ? (
              <p className="text-muted text-center py-8 mb-0">No top-ups yet.</p>
            ) : (
              <ul className="list-group rc-wallet-history">
                {topUps.map(item => (
                  <li key={item.id} className="list-item p-4 border-b rc-wallet-history-item">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <p className="font-medium mb-1">{formatRcFeeAmount(item.amountInr)}</p>
                        <p className="text-sm text-muted mb-1">
                          {new Date(item.submittedAt).toLocaleString()}
                        </p>
                        {item.note && <p className="text-sm mb-0">{item.note}</p>}
                        {item.status === 'rejected' && item.rejectionReason && (
                          <p className="text-sm text-red mt-1 mb-0">{item.rejectionReason}</p>
                        )}
                      </div>
                      <span className={`rc-wallet-status rc-wallet-status--${item.status}`}>
                        {walletTopUpStatusLabel(item.status)}
                      </span>
                    </div>
                    {item.screenshotUrl || item.screenshotPath ? (
                      <div className="rc-wallet-history-thumb mt-3">
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
          </div>
        </div>
      </div>
    </div>
  );
};
