import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { useConfirm } from '../../context/ConfirmContext';
import { StorageImage } from '../../components/StorageImage';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { db } from '../../firebase';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import {
  deleteWalletTopUp,
  fetchAllRcWallets,
  fetchWalletLedger,
  fetchWalletTopUps,
  reviewWalletTopUp,
  walletLedgerTypeLabel,
  walletTopUpStatusLabel,
} from '../../lib/rcWallet';
import {
  isWalletTopUpZohoTransferOutstanding,
  pushLegacyWalletTopUpZohoTransfer,
} from '../../lib/zohoWalletTransfer';
import { normalizeZohoNumericId } from '../../lib/zohoSettings';
import { isManualWalletRechargeMode } from '../../lib/razorpaySettings';
import { useAppSettings } from '../../hooks/useAppSettings';
import type { FirestoreUserDoc, WalletLedgerEntry, WalletTopUp } from '../../types';
import { CheckCircle2, FileText, IndianRupee, RefreshCw, Trash2, Wallet, X, XCircle } from 'lucide-react';

function WalletZohoPushedBadge() {
  return <span className="admin-wallet-zoho-pushed-badge">Zoho pushed</span>;
}

function splitWalletTimestamp(iso: string): { date: string; time: string } {
  const value = new Date(iso);
  return {
    date: value.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: value.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  };
}

function WalletScreenshotThumb({
  url,
  path,
}: {
  url?: string | null;
  path?: string | null;
}) {
  if (!url && !path) {
    return <span className="product-table-thumb-placeholder" aria-hidden>—</span>;
  }

  return (
    <StorageImage
      url={url}
      path={path}
      alt="Payment screenshot"
      className="product-table-thumb"
    />
  );
}

export const AdminWalletTopUps: React.FC = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { appSettings } = useAppSettings();
  const manualRecharge = isManualWalletRechargeMode(appSettings);
  const [topUps, setTopUps] = useState<WalletTopUp[]>([]);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [error, setError] = useState('');
  const [rejectTarget, setRejectTarget] = useState<WalletTopUp | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pushingZohoTopUpId, setPushingZohoTopUpId] = useState<string | null>(null);
  const [topUpById, setTopUpById] = useState<Map<string, WalletTopUp>>(new Map());
  const [rcNamesById, setRcNamesById] = useState<Record<string, string>>({});
  const [walletBalancesByRcId, setWalletBalancesByRcId] = useState<Record<string, number>>({});

  const refreshLookup = useCallback(async () => {
    const [allTopUps, userSnap, wallets] = await Promise.all([
      fetchWalletTopUps({}),
      getDocs(collection(db, 'users')),
      fetchAllRcWallets(),
    ]);

    const names: Record<string, string> = {};
    userSnap.docs.forEach(docSnap => {
      const data = docSnap.data() as FirestoreUserDoc;
      if (data.role === 'rc_admin') {
        names[docSnap.id] =
          data.companyName?.trim() || data.username?.trim() || docSnap.id;
      }
    });

    const balances: Record<string, number> = {};
    wallets.forEach(wallet => {
      balances[wallet.rcId] = wallet.balanceInr;
    });

    setTopUpById(new Map(allTopUps.map(row => [row.id, row])));
    setRcNamesById(names);
    setWalletBalancesByRcId(balances);
  }, []);

  const resolveRcName = useCallback(
    (rcId: string, topUp?: WalletTopUp | null) =>
      topUp?.rcCompanyName?.trim() || rcNamesById[rcId] || 'Regional Center',
    [rcNamesById],
  );

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
    await Promise.all([refreshTopUps(), refreshLedger(), refreshLookup()]);
  }, [refreshTopUps, refreshLedger, refreshLookup]);

  useEffect(() => {
    setFilter(manualRecharge ? 'pending' : 'all');
  }, [manualRecharge]);

  useEffect(() => {
    void refreshLookup();
  }, [refreshLookup]);

  useEffect(() => {
    void refreshTopUps();
  }, [refreshTopUps]);

  useEffect(() => {
    void refreshLedger();
  }, [refreshLedger]);

  const pendingCount = topUps.filter(item => item.status === 'pending').length;

  const zohoWalletPushBlockedReason = useCallback((topUp: WalletTopUp) => {
    const fromId = normalizeZohoNumericId(appSettings.zohoWalletFromAccountId);
    if (fromId.length < 10) {
      return 'Configure GATC Wallet account ID in Admin Zoho settings.';
    }
    const toId = topUp.rechargeMethod === 'razorpay'
      ? normalizeZohoNumericId(appSettings.zohoRazorpayAccountId)
      : normalizeZohoNumericId(appSettings.zohoWalletToAccountId);
    if (toId.length < 10) {
      return topUp.rechargeMethod === 'razorpay'
        ? 'Configure Zoho Razorpay account ID in Integrations → Razorpay.'
        : 'Configure Kotak account ID in Admin Zoho settings.';
    }
    return null;
  }, [
    appSettings.zohoWalletFromAccountId,
    appSettings.zohoWalletToAccountId,
    appSettings.zohoRazorpayAccountId,
  ]);

  const handlePushZohoTopUp = async (topUp: WalletTopUp, rcName: string) => {
    const blocked = zohoWalletPushBlockedReason(topUp);
    if (blocked) {
      setError(blocked);
      return;
    }

    const zohoTarget = topUp.rechargeMethod === 'razorpay' ? 'Razorpay' : 'Kotak';
    const ok = await confirm({
      title: 'Push wallet top-up to Zoho?',
      message:
        `Record GATC Wallet → ${zohoTarget} transfer for ${formatRcFeeAmount(topUp.amountInr)} ` +
        `(${rcName}) in Zoho Books?`,
      confirmLabel: 'Push to Zoho',
    });
    if (!ok) return;

    setPushingZohoTopUpId(topUp.id);
    setError('');
    try {
      await pushLegacyWalletTopUpZohoTransfer({ topUpId: topUp.id });
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Zoho wallet transfer failed.');
    } finally {
      setPushingZohoTopUpId(null);
    }
  };

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
      const result = await reviewWalletTopUp({ topUpId: item.id, action: 'approve' });
      await refresh();
      if (result.zohoTransferStatus === 'failed') {
        setError(
          result.zohoTransferError?.trim()
            ? `Top-up approved, but Zoho transfer failed: ${result.zohoTransferError}`
            : 'Top-up approved, but Zoho transfer failed. Use Push to Zoho to retry.',
        );
      }
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

  const handleDeleteTopUp = async (item: WalletTopUp) => {
    const ok = await confirm({
      title: 'Delete wallet top-up?',
      message:
        item.status === 'approved'
          ? `Permanently delete this approved top-up and remove ${formatRcFeeAmount(item.amountInr)} from ${item.rcCompanyName || item.rcId}'s wallet balance?`
          : `Permanently delete this ${item.status} top-up from ${item.rcCompanyName || item.rcId}?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;

    setDeletingId(item.id);
    setError('');
    try {
      await deleteWalletTopUp(item.id);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeletingId(null);
    }
  };

  const rcWalletBalances = Object.entries(rcNamesById)
    .map(([rcId, name]) => ({
      rcId,
      name,
      balanceInr: walletBalancesByRcId[rcId] ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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

      <div className="panel glass admin-wallet-balances-panel">
        <div className="panel-header">
          <h2><IndianRupee className="inline-icon" /> RC wallet balances</h2>
          {!loading && rcWalletBalances.length > 0 && (
            <span className="text-muted text-sm">{rcWalletBalances.length} centres</span>
          )}
        </div>
        <div className="panel-body">
          {loading ? (
            <div className="admin-wallet-balances-empty"><span className="spinner-inline" /></div>
          ) : rcWalletBalances.length === 0 ? (
            <p className="admin-wallet-balances-empty text-muted mb-0">No RC centres found.</p>
          ) : (
            <table className="admin-wallet-balances-table">
              <tbody>
                {rcWalletBalances.map(row => (
                  <tr key={row.rcId}>
                    <td className="admin-wallet-balances-table__name">{row.name}</td>
                    <td className="admin-wallet-balances-table__amount">
                      {formatRcFeeAmount(row.balanceInr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel glass mt-4">
        <div className="panel-header">
          <h2><Wallet className="inline-icon" /> Wallet top-ups</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {manualRecharge && pendingCount > 0 && (
              <span className="badge-count">{pendingCount} pending</span>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
              <RefreshCw size={14} aria-hidden /> Refresh
            </button>
          </div>
        </div>

        <div className="panel-body">
          {!manualRecharge && (
            <p className="text-muted text-sm mb-4">
              Wallet recharges use Razorpay and are credited automatically. Switch to Manual mode in
              Integrations → Razorpay to review payment screenshots.
            </p>
          )}

          <div className="admin-wallet-filters mb-4">
            {(['all', 'pending', 'approved', 'rejected'] as const)
              .filter(value => manualRecharge || value !== 'pending')
              .map(value => (
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
            <div className="table-scroll-wrap">
              <table className="data-table data-table--admin-wallet data-table--mobile-cards">
                <thead>
                  <tr>
                    <th>Screenshot</th>
                    <th>RC</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {topUps.map(item => {
                    const { date, time } = splitWalletTimestamp(item.submittedAt);
                    const rcName = resolveRcName(item.rcId, item);
                    return (
                      <tr key={item.id} className="table-mobile-row table-mobile-row--media-actions">
                        <td className="table-mobile-col-media">
                          <WalletScreenshotThumb
                            url={item.screenshotUrl}
                            path={item.screenshotPath}
                          />
                        </td>
                        <td className="table-mobile-col-primary font-medium">
                          <span className="table-mobile-primary-text">{rcName}</span>
                          <div className="table-mobile-summary">
                            <span className="table-mobile-summary-meta">
                              {date} · {time}
                            </span>
                            <span className="table-mobile-summary-badges">
                              <span className="admin-wallet-table-amount">
                                <IndianRupee size={12} aria-hidden />
                                {formatRcFeeAmount(item.amountInr).replace('₹', '').trim()}
                              </span>
                              <span className={`rc-wallet-status rc-wallet-status--${item.status}`}>
                                {walletTopUpStatusLabel(item.status)}
                              </span>
                              {item.rechargeMethod === 'razorpay' && (
                                <span className="admin-wallet-recharge-badge">Razorpay</span>
                              )}
                              {item.zohoTransferStatus === 'completed' && <WalletZohoPushedBadge />}
                            </span>
                            {item.note ? (
                              <span className="table-mobile-summary-meta">{item.note}</span>
                            ) : null}
                            {item.status === 'rejected' && item.rejectionReason ? (
                              <span className="form-error table-mobile-summary-meta">
                                {item.rejectionReason}
                              </span>
                            ) : null}
                            {item.zohoTransferStatus === 'failed' && item.zohoTransferError ? (
                              <span className="form-error table-mobile-summary-meta text-xs">
                                Zoho: {item.zohoTransferError}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="table-mobile-col-hide text-muted text-sm">{date}</td>
                        <td className="table-mobile-col-hide text-muted text-sm">{time}</td>
                        <td className="table-mobile-col-hide font-medium">
                          {formatRcFeeAmount(item.amountInr)}
                        </td>
                        <td className="table-mobile-col-hide">
                          <span className={`rc-wallet-status rc-wallet-status--${item.status}`}>
                            {walletTopUpStatusLabel(item.status)}
                          </span>
                          {item.zohoTransferStatus === 'completed' && (
                            <span className="admin-wallet-zoho-desktop-meta text-mono">
                              Zoho · {item.zohoReferenceNumber || item.zohoTransactionId}
                              {item.zohoTransferDate ? ` · ${item.zohoTransferDate}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="table-mobile-col-actions text-right">
                          <div className="admin-wallet-table-actions">
                            {manualRecharge && item.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={reviewingId === item.id || deletingId === item.id}
                                  onClick={() => void handleApprove(item)}
                                >
                                  <CheckCircle2 size={14} aria-hidden />
                                  {reviewingId === item.id ? 'Processing…' : 'Approve'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  disabled={reviewingId === item.id || deletingId === item.id}
                                  onClick={() => openRejectModal(item)}
                                >
                                  <XCircle size={14} aria-hidden />
                                  Reject
                                </button>
                              </>
                            )}
                            {isWalletTopUpZohoTransferOutstanding(item) && item.status === 'approved' && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={
                                  pushingZohoTopUpId === item.id
                                  || deletingId === item.id
                                  || reviewingId === item.id
                                }
                                onClick={() => void handlePushZohoTopUp(item, rcName)}
                              >
                                <FileText size={14} aria-hidden />
                                {pushingZohoTopUpId === item.id ? 'Pushing…' : 'Push to Zoho'}
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm admin-wallet-delete-btn"
                              disabled={deletingId === item.id || reviewingId === item.id}
                              onClick={() => void handleDeleteTopUp(item)}
                            >
                              <Trash2 size={14} aria-hidden />
                              {deletingId === item.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
            <div className="table-scroll-wrap">
              <table className="data-table data-table--admin-wallet data-table--mobile-cards">
                <thead>
                  <tr>
                    <th>Screenshot</th>
                    <th>RC</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Balance</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map(entry => {
                    const linkedTopUp = entry.topUpId ? topUpById.get(entry.topUpId) : undefined;
                    const { date, time } = splitWalletTimestamp(entry.createdAt);
                    const rcName = resolveRcName(entry.rcId, linkedTopUp);
                    const isCredit = entry.amountInr >= 0;
                    return (
                      <tr key={entry.id} className="table-mobile-row table-mobile-row--media-actions">
                        <td className="table-mobile-col-media">
                          <WalletScreenshotThumb
                            url={linkedTopUp?.screenshotUrl}
                            path={linkedTopUp?.screenshotPath}
                          />
                        </td>
                        <td className="table-mobile-col-primary font-medium">
                          <span className="table-mobile-primary-text">{rcName}</span>
                          <div className="table-mobile-summary">
                            <span className="table-mobile-summary-meta">
                              {date} · {time}
                            </span>
                            <span className="table-mobile-summary-meta">
                              {walletLedgerTypeLabel(entry.type)}
                              {entry.recordIds?.length
                                ? ` · ${entry.recordIds.length} record(s)`
                                : ''}
                            </span>
                            <span className="table-mobile-summary-badges">
                              <span
                                className={`admin-wallet-table-amount ${
                                  isCredit
                                    ? 'admin-wallet-ledger-item__amount--credit'
                                    : 'admin-wallet-ledger-item__amount--debit'
                                }`}
                              >
                                {isCredit ? '+' : '−'}
                                {formatRcFeeAmount(Math.abs(entry.amountInr)).replace('₹', '').trim()}
                              </span>
                              <span className="table-mobile-summary-meta">
                                Balance {formatRcFeeAmount(entry.balanceAfterInr)}
                              </span>
                              {linkedTopUp?.zohoTransferStatus === 'completed' && <WalletZohoPushedBadge />}
                            </span>
                            {entry.status === 'refunded' || entry.refundReason ? (
                              <span className="table-mobile-summary-meta">
                                {entry.status === 'refunded' ? 'Refunded' : ''}
                                {entry.refundReason ? ` · ${entry.refundReason}` : ''}
                              </span>
                            ) : null}
                            {linkedTopUp?.zohoTransferStatus === 'failed' && linkedTopUp.zohoTransferError ? (
                              <span className="form-error table-mobile-summary-meta text-xs">
                                Zoho: {linkedTopUp.zohoTransferError}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="table-mobile-col-hide text-muted text-sm">{date}</td>
                        <td className="table-mobile-col-hide text-muted text-sm">{time}</td>
                        <td className="table-mobile-col-hide">
                          {walletLedgerTypeLabel(entry.type)}
                          {linkedTopUp?.zohoTransferStatus === 'completed' && (
                            <span className="admin-wallet-zoho-desktop-meta text-mono">
                              Zoho · {linkedTopUp.zohoReferenceNumber || linkedTopUp.zohoTransactionId}
                              {linkedTopUp.zohoTransferDate ? ` · ${linkedTopUp.zohoTransferDate}` : ''}
                            </span>
                          )}
                        </td>
                        <td
                          className={`table-mobile-col-hide font-medium ${
                            isCredit
                              ? 'admin-wallet-ledger-item__amount--credit'
                              : 'admin-wallet-ledger-item__amount--debit'
                          }`}
                        >
                          {isCredit ? '+' : '−'}
                          {formatRcFeeAmount(Math.abs(entry.amountInr))}
                        </td>
                        <td className="table-mobile-col-hide text-muted text-sm">
                          {formatRcFeeAmount(entry.balanceAfterInr)}
                        </td>
                        <td className="table-mobile-col-actions text-right">
                          <div className="admin-wallet-table-actions">
                            {entry.type === 'top_up_credit'
                              && linkedTopUp
                              && isWalletTopUpZohoTransferOutstanding(linkedTopUp) && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={pushingZohoTopUpId === linkedTopUp.id}
                                onClick={() => void handlePushZohoTopUp(linkedTopUp, rcName)}
                              >
                                <FileText size={14} aria-hidden />
                                {pushingZohoTopUpId === linkedTopUp.id ? 'Pushing…' : 'Push to Zoho'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
