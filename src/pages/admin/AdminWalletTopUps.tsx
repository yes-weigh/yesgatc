import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../../context/ConfirmContext';
import { StorageImage } from '../../components/StorageImage';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import {
  fetchWalletLedger,
  fetchWalletTopUps,
  reviewWalletTopUp,
  walletLedgerTypeLabel,
  walletTopUpStatusLabel,
} from '../../lib/rcWallet';
import type { WalletLedgerEntry, WalletTopUp } from '../../types';
import { CheckCircle2, IndianRupee, RefreshCw, Wallet, X, XCircle } from 'lucide-react';

export const AdminWalletTopUps: React.FC = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [topUps, setTopUps] = useState<WalletTopUp[]>([]);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [error, setError] = useState('');
  const [rejectTarget, setRejectTarget] = useState<WalletTopUp | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const refreshTopUps = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchWalletTopUps(filter === 'all' ? {} : { status: filter });
      rows.sort((a, b) => {
        const aPending = a.status === 'pending' ? 0 : 1;
        const bPending = b.status === 'pending' ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return b.submittedAt.localeCompare(a.submittedAt);
      });
      setTopUps(rows);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const refreshLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const rows = await fetchWalletLedger({ limit: 50 });
      setLedger(rows);
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshTopUps(), refreshLedger()]);
  }, [refreshTopUps, refreshLedger]);

  useEffect(() => {
    void refreshTopUps();
  }, [refreshTopUps]);

  useEffect(() => {
    void refreshLedger();
  }, [refreshLedger]);

  const pendingCount = topUps.filter(item => item.status === 'pending').length;

  const handleApprove = async (item: WalletTopUp) => {
    const ok = await confirm({
      title: 'Approve wallet top-up?',
      message: `Credit ${formatRcFeeAmount(item.amountInr)} to ${item.rcCompanyName || item.rcId}?`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;

    setReviewingId(item.id);
    setError('');
    try {
      await reviewWalletTopUp({ topUpId: item.id, action: 'approve' });
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setReviewingId(null);
    }
  };

  const openRejectModal = (item: WalletTopUp) => {
    setRejectTarget(item);
    setRejectReason('');
    setError('');
  };

  const closeRejectModal = () => {
    if (reviewingId) return;
    setRejectTarget(null);
    setRejectReason('');
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setError('Enter a rejection reason for the RC Admin.');
      return;
    }

    setReviewingId(rejectTarget.id);
    setError('');
    try {
      await reviewWalletTopUp({
        topUpId: rejectTarget.id,
        action: 'reject',
        rejectionReason: reason,
      });
      setRejectTarget(null);
      setRejectReason('');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Rejection failed.');
    } finally {
      setReviewingId(null);
    }
  };

  return (
    <div className="fade-in">
      <ListViewBackBar onBack={() => navigate('/admin')} label="Back to dashboard" />

      <div className="panel glass">
        <div className="panel-header">
          <h2><Wallet className="inline-icon" /> Wallet top-ups</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {pendingCount > 0 && <span className="badge-count">{pendingCount} pending</span>}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden /> Refresh
            </button>
          </div>
        </div>

        <div className="panel-body">
          <div className="admin-wallet-filters mb-4">
            {(['all', 'pending', 'approved', 'rejected'] as const).map(value => (
              <button
                key={value}
                type="button"
                className={`btn btn-sm ${filter === value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : walletTopUpStatusLabel(value)}
              </button>
            ))}
          </div>

          {error && <p className="form-error mb-3">{error}</p>}

          {loading ? (
            <div className="text-center py-10"><span className="spinner-inline" /></div>
          ) : topUps.length === 0 ? (
            <p className="text-muted text-center py-10 mb-0">No wallet top-ups found.</p>
          ) : (
            <div className="admin-wallet-list">
              {topUps.map(item => (
                <article key={item.id} className="admin-wallet-card">
                  <div className="admin-wallet-card__head">
                    <div>
                      <h3 className="admin-wallet-card__title">
                        {item.rcCompanyName?.trim() || 'Regional Center'}
                      </h3>
                      <p className="text-sm text-muted mb-0">
                        {new Date(item.submittedAt).toLocaleString()}
                        {item.reviewedAt
                          ? ` · reviewed ${new Date(item.reviewedAt).toLocaleString()}`
                          : ''}
                      </p>
                    </div>
                    <div className="admin-wallet-card__meta">
                      <span className="admin-wallet-card__amount">
                        <IndianRupee size={14} aria-hidden />
                        {formatRcFeeAmount(item.amountInr).replace('₹', '').trim()}
                      </span>
                      <span className={`rc-wallet-status rc-wallet-status--${item.status}`}>
                        {walletTopUpStatusLabel(item.status)}
                      </span>
                    </div>
                  </div>

                  {item.note && <p className="text-sm mb-3">{item.note}</p>}

                  {(item.screenshotUrl || item.screenshotPath) && (
                    <div className="admin-wallet-card__screenshot">
                      <StorageImage
                        url={item.screenshotUrl}
                        path={item.screenshotPath}
                        alt="Payment screenshot"
                        className="admin-wallet-card__screenshot-img"
                      />
                    </div>
                  )}

                  {item.status === 'rejected' && item.rejectionReason && (
                    <p className="form-error mt-2 mb-0">{item.rejectionReason}</p>
                  )}

                  {item.status === 'pending' && (
                    <div className="admin-wallet-card__actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={reviewingId === item.id}
                        onClick={() => void handleApprove(item)}
                      >
                        <CheckCircle2 size={14} aria-hidden />
                        {reviewingId === item.id ? 'Processing…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={reviewingId === item.id}
                        onClick={() => openRejectModal(item)}
                      >
                        <XCircle size={14} aria-hidden />
                        Reject
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel glass mt-4">
        <div className="panel-header">
          <h2>Wallet ledger</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refreshLedger()}>
            <RefreshCw size={14} aria-hidden /> Refresh
          </button>
        </div>
        <div className="panel-body">
          {ledgerLoading ? (
            <div className="text-center py-8"><span className="spinner-inline" /></div>
          ) : ledger.length === 0 ? (
            <p className="text-muted text-center py-8 mb-0">No ledger entries yet.</p>
          ) : (
            <div className="admin-wallet-ledger-list">
              {ledger.map(entry => (
                <article key={entry.id} className="admin-wallet-ledger-item">
                  <div className="admin-wallet-ledger-item__head">
                    <div>
                      <p className="admin-wallet-ledger-item__type">{walletLedgerTypeLabel(entry.type)}</p>
                      <p className="text-sm text-muted mb-0">
                        {entry.rcId}
                        {entry.recordIds?.length ? ` · ${entry.recordIds.length} record(s)` : ''}
                      </p>
                    </div>
                    <div className="admin-wallet-ledger-item__meta">
                      <span
                        className={`admin-wallet-ledger-item__amount ${
                          entry.amountInr >= 0 ? 'admin-wallet-ledger-item__amount--credit' : 'admin-wallet-ledger-item__amount--debit'
                        }`}
                      >
                        {entry.amountInr >= 0 ? '+' : '−'}
                        {formatRcFeeAmount(Math.abs(entry.amountInr)).replace('₹', '').trim()}
                      </span>
                      <span className="text-sm text-muted">
                        Balance {formatRcFeeAmount(entry.balanceAfterInr)}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted mb-0">
                    {new Date(entry.createdAt).toLocaleString()}
                    {entry.status === 'refunded' ? ' · refunded' : ''}
                    {entry.refundReason ? ` · ${entry.refundReason}` : ''}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {rejectTarget &&
        createPortal(
          <div className="rv-payment-overlay" role="dialog" aria-modal="true" aria-label="Reject wallet top-up">
            <div className="rv-payment-panel glass admin-wallet-reject-modal">
              <header className="rv-payment-panel-head">
                <div className="rv-payment-panel-title-wrap">
                  <XCircle size={20} aria-hidden />
                  <h2 className="rv-payment-panel-title">Reject top-up</h2>
                </div>
                <button
                  type="button"
                  className="rv-payment-panel-close"
                  onClick={closeRejectModal}
                  disabled={Boolean(reviewingId)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </header>

              <div className="rv-payment-panel-body">
                <p className="text-muted text-sm mb-3">
                  Reject {formatRcFeeAmount(rejectTarget.amountInr)} from{' '}
                  {rejectTarget.rcCompanyName || rejectTarget.rcId}. The reason is shown to the RC Admin.
                </p>

                <div className="form-group">
                  <label htmlFor="wallet-reject-reason">Rejection reason</label>
                  <textarea
                    id="wallet-reject-reason"
                    className="input-field"
                    rows={4}
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="e.g. Screenshot does not match amount or reference"
                    disabled={Boolean(reviewingId)}
                  />
                </div>

                <div className="rv-payment-panel-actions mt-4">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeRejectModal}
                    disabled={Boolean(reviewingId)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleRejectConfirm()}
                    disabled={Boolean(reviewingId) || !rejectReason.trim()}
                  >
                    {reviewingId ? 'Rejecting…' : 'Reject top-up'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
