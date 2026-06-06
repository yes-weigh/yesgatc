import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../../context/ConfirmContext';
import { StorageImage } from '../../components/StorageImage';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import {
  fetchWalletTopUps,
  reviewWalletTopUp,
  walletTopUpStatusLabel,
} from '../../lib/rcWallet';
import type { WalletTopUp } from '../../types';
import { CheckCircle2, IndianRupee, RefreshCw, Wallet, XCircle } from 'lucide-react';

export const AdminWalletTopUps: React.FC = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [topUps, setTopUps] = useState<WalletTopUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchWalletTopUps(
        filter === 'all' ? {} : { status: filter },
      );
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const handleReject = async (item: WalletTopUp) => {
    const reason = window.prompt('Reason for rejection (shown to RC Admin):');
    if (!reason?.trim()) return;

    setReviewingId(item.id);
    setError('');
    try {
      await reviewWalletTopUp({
        topUpId: item.id,
        action: 'reject',
        rejectionReason: reason.trim(),
      });
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
                        onClick={() => void handleReject(item)}
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
    </div>
  );
};
