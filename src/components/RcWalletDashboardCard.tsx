import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, IndianRupee, Wallet } from 'lucide-react';
import { formatRcFeeAmount } from '../lib/rcProfileFields';
import { subscribeRcWalletBalance, subscribeWalletTopUps } from '../lib/rcWallet';
import { useRcScope, useRoleBasePath } from '../lib/roleScope';

export const RcWalletDashboardCard: React.FC = () => {
  const { rcUid, isVct } = useRcScope();
  const basePath = useRoleBasePath();
  const [balance, setBalance] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rcUid) {
      setBalance(0);
      setPendingCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubBalance = subscribeRcWalletBalance(
      rcUid,
      value => {
        setBalance(value);
        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubTopUps = isVct
      ? () => {}
      : subscribeWalletTopUps(
          { rcId: rcUid, status: 'pending' },
          rows => {
            setPendingCount(rows.length);
            setLoading(false);
          },
          () => setLoading(false),
        );

    return () => {
      unsubBalance();
      unsubTopUps();
    };
  }, [rcUid, isVct]);

  if (!rcUid) return null;

  const balanceLabel = isVct ? 'RC wallet balance' : 'Wallet balance';
  const subLabel = isVct
    ? 'Shared RC centre wallet — used for RV verification fees'
    : pendingCount > 0
      ? `${pendingCount} top-up${pendingCount === 1 ? '' : 's'} awaiting approval`
      : 'Add payment screenshot to top up';

  const cardBody = (
    <>
      <div className="rc-kpi-card__glow" aria-hidden="true" />
      <div className="rc-kpi-card__top">
        <div className="rc-kpi-card__icon">
          <Wallet size={22} />
        </div>
        {!isVct && <ArrowUpRight size={16} className="rc-kpi-card__arrow" aria-hidden="true" />}
      </div>
      <div className="rc-kpi-card__body">
        <p className="rc-kpi-card__label">{balanceLabel}</p>
        {loading ? (
          <span className="rc-kpi-card__skeleton" aria-hidden="true" />
        ) : (
          <p className="rc-kpi-card__value">
            <IndianRupee size={18} className="inline-icon" aria-hidden />
            {formatRcFeeAmount(balance).replace('₹', '').trim()}
          </p>
        )}
        <p className="rc-kpi-card__sub">{subLabel}</p>
      </div>
    </>
  );

  if (isVct) {
    return (
      <div
        className="rc-kpi-card rc-kpi-card--violet rc-wallet-dashboard-card rc-wallet-dashboard-card--readonly"
        aria-label="RC wallet balance"
      >
        {cardBody}
      </div>
    );
  }

  return (
    <Link to={`${basePath}/wallet`} className="rc-kpi-card rc-kpi-card--violet rc-wallet-dashboard-card">
      {cardBody}
    </Link>
  );
};
