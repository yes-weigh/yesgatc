import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, IndianRupee, Wallet } from 'lucide-react';
import { formatRcFeeAmount } from '../lib/rcProfileFields';
import { fetchRcWalletBalance, fetchWalletTopUps } from '../lib/rcWallet';
import { useRcScope } from '../lib/roleScope';

export const RcWalletDashboardCard: React.FC = () => {
  const { rcUid, isRcAdmin } = useRcScope();
  const [balance, setBalance] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rcUid || !isRcAdmin) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [walletBalance, pending] = await Promise.all([
          fetchRcWalletBalance(rcUid),
          fetchWalletTopUps({ rcId: rcUid, status: 'pending' }),
        ]);
        if (!cancelled) {
          setBalance(walletBalance);
          setPendingCount(pending.length);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rcUid, isRcAdmin]);

  if (!isRcAdmin) return null;

  return (
    <Link to="/rc/wallet" className="rc-kpi-card rc-kpi-card--violet rc-wallet-dashboard-card">
      <div className="rc-kpi-card__glow" aria-hidden="true" />
      <div className="rc-kpi-card__top">
        <div className="rc-kpi-card__icon">
          <Wallet size={22} />
        </div>
        <ArrowUpRight size={16} className="rc-kpi-card__arrow" aria-hidden="true" />
      </div>
      <div className="rc-kpi-card__body">
        <p className="rc-kpi-card__label">Wallet balance</p>
        {loading ? (
          <span className="rc-kpi-card__skeleton" aria-hidden="true" />
        ) : (
          <p className="rc-kpi-card__value">
            <IndianRupee size={18} className="inline-icon" aria-hidden />
            {formatRcFeeAmount(balance ?? 0).replace('₹', '').trim()}
          </p>
        )}
        <p className="rc-kpi-card__sub">
          {pendingCount > 0
            ? `${pendingCount} top-up${pendingCount === 1 ? '' : 's'} awaiting approval`
            : 'Add payment screenshot to top up'}
        </p>
      </div>
    </Link>
  );
};
