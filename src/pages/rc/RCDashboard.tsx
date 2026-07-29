import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import {
  Wallet,
  LayoutGrid,
  FileText,
  Send,
  Award,
  XCircle,
  FilePenLine,
  BarChart3,
  Plus,
  ChevronRight,
  UploadCloud,
} from 'lucide-react';
import { RcVehicleRequiredNotice } from '../../components/RcVehicleRequiredNotice';
import { db } from '../../firebase';
import { fetchRcVehicles, rcHasRegisteredVehicle } from '../../lib/rcVehicles';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import { subscribeRcWalletBalance, subscribeWalletTopUps } from '../../lib/rcWallet';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { useRoleBasePath, useRcScope } from '../../lib/roleScope';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import {
  getVerificationDisplayStatus,
  sanitizeVerificationDisplayText,
  tallyVerificationStatusFilters,
  tallyVerificationTypeFilters,
  type VerificationStatusFilter,
} from '../../lib/verificationRequest';
import type { SiteCalibration } from '../../types';

type StageTone = 'blue' | 'violet' | 'green' | 'red' | 'orange';

type StageCard = {
  key: VerificationStatusFilter;
  label: string;
  count: number;
  tone: StageTone;
  icon: React.ReactNode;
};

function recordListId(record: SiteCalibration): string {
  for (const value of [
    record.certificateNumber,
    record.applicationNumber,
    record.sealIdentificationNumber,
  ]) {
    const text = sanitizeVerificationDisplayText(value);
    if (text !== '—') return text;
  }
  return '—';
}

function certifiedThisMonthCount(records: SiteCalibration[]): number {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  return records.filter(record => {
    if (getVerificationDisplayStatus(record) !== 'certified') return false;
    const raw = record.certifiedAt || record.approvedAt || record.createdAt;
    if (!raw) return false;
    const date = new Date(raw);
    return date.getMonth() === month && date.getFullYear() === year;
  }).length;
}

export const RCDashboard: React.FC = () => {
  const { rcUid, actorUid, isVct, isRcAdmin } = useRcScope();
  const basePath = useRoleBasePath();
  const navigate = useNavigate();
  const [verifications, setVerifications] = useState<SiteCalibration[]>([]);
  const [loadingVerifications, setLoadingVerifications] = useState(true);
  const [rcHasVehicle, setRcHasVehicle] = useState<boolean | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [pendingTopUps, setPendingTopUps] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);

  const fetchVerifications = useCallback(async () => {
    if (!rcUid) return;
    setLoadingVerifications(true);
    try {
      const q = verificationRecordsQuery(db, rcUid, { isVct, actorUid });
      const snap = await getDocs(q);
      setVerifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as SiteCalibration)));
    } finally {
      setLoadingVerifications(false);
    }
  }, [rcUid, isVct, actorUid]);

  useEffect(() => {
    void fetchVerifications();
  }, [fetchVerifications]);

  useEffect(() => {
    if (!rcUid || !isRcAdmin) {
      setRcHasVehicle(null);
      return;
    }
    let cancelled = false;
    void fetchRcVehicles(rcUid).then(vehicles => {
      if (!cancelled) setRcHasVehicle(rcHasRegisteredVehicle(vehicles));
    });
    return () => {
      cancelled = true;
    };
  }, [rcUid, isRcAdmin]);

  useEffect(() => {
    if (!rcUid) {
      setWalletBalance(0);
      setPendingTopUps(0);
      setWalletLoading(false);
      return;
    }
    setWalletLoading(true);
    const unsubBalance = subscribeRcWalletBalance(
      rcUid,
      value => {
        setWalletBalance(value);
        setWalletLoading(false);
      },
      () => setWalletLoading(false),
    );
    const unsubTopUps = isVct
      ? () => {}
      : subscribeWalletTopUps(
          { rcId: rcUid, status: 'pending' },
          rows => {
            setPendingTopUps(rows.length);
            setWalletLoading(false);
          },
          () => setWalletLoading(false),
        );
    return () => {
      unsubBalance();
      unsubTopUps();
    };
  }, [rcUid, isVct]);

  const tally = useMemo(() => tallyVerificationStatusFilters(verifications), [verifications]);
  const typeTally = useMemo(() => tallyVerificationTypeFilters(verifications), [verifications]);

  const stages = useMemo<StageCard[]>(
    () => [
      {
        key: 'all',
        label: 'All Stages',
        count: tally.all,
        tone: 'blue',
        icon: <LayoutGrid size={18} strokeWidth={1.9} />,
      },
      {
        key: 'draft',
        label: 'Draft',
        count: tally.draft,
        tone: 'violet',
        icon: <FileText size={18} strokeWidth={1.9} />,
      },
      {
        key: 'submitted',
        label: 'Submitted',
        count: tally.submitted,
        tone: 'blue',
        icon: <Send size={18} strokeWidth={1.9} />,
      },
      {
        key: 'failed_submit',
        label: 'Failed at Submission',
        count: tally.failed_submit,
        tone: 'red',
        icon: <UploadCloud size={18} strokeWidth={1.9} />,
      },
      {
        key: 'certified',
        label: 'Certified',
        count: tally.certified,
        tone: 'green',
        icon: <Award size={18} strokeWidth={1.9} />,
      },
      {
        key: 'rejected',
        label: 'Rejected',
        count: tally.rejected,
        tone: 'orange',
        icon: <XCircle size={18} strokeWidth={1.9} />,
      },
    ],
    [tally],
  );

  const certifiedMonth = useMemo(() => certifiedThisMonthCount(verifications), [verifications]);

  const recent = useMemo(
    () =>
      [...verifications]
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 6),
    [verifications],
  );

  const walletSub = isVct
    ? 'Shared RC centre wallet for RV fees'
    : pendingTopUps > 0
      ? `${pendingTopUps} top-up${pendingTopUps === 1 ? '' : 's'} awaiting approval`
      : 'Add payment screenshot to top up';

  const verificationHref = (status?: VerificationStatusFilter) =>
    status && status !== 'all'
      ? `${basePath}/verification?status=${encodeURIComponent(status)}`
      : `${basePath}/verification`;

  const openRecord = (record: SiteCalibration) => {
    navigate(`${basePath}/verification?open=${encodeURIComponent(record.id)}`);
  };

  return (
    <div className="fade-in wl-dash">
      {isRcAdmin && rcHasVehicle === false ? <RcVehicleRequiredNotice variant="rc" /> : null}

      {rcUid ? (
        isVct ? (
          <section className="wl-wallet" aria-label="Wallet balance">
            <div className="wl-wallet__icon" aria-hidden>
              <Wallet size={22} strokeWidth={2} />
            </div>
            <div className="wl-wallet__copy">
              <p className="wl-wallet__label">Wallet Balance</p>
              <p className="wl-wallet__value">
                {walletLoading ? '—' : formatRcFeeAmount(walletBalance).replace('₹', '₹ ')}
              </p>
              <p className="wl-wallet__hint">{walletSub}</p>
            </div>
          </section>
        ) : (
          <section className="wl-wallet" aria-label="Wallet balance">
            <div className="wl-wallet__icon" aria-hidden>
              <Wallet size={22} strokeWidth={2} />
            </div>
            <div className="wl-wallet__copy">
              <p className="wl-wallet__label">Wallet Balance</p>
              <p className="wl-wallet__value">
                {walletLoading ? '—' : formatRcFeeAmount(walletBalance).replace('₹', '₹ ')}
              </p>
              <p className="wl-wallet__hint">{walletSub}</p>
            </div>
            <Link to={`${basePath}/wallet`} className="wl-wallet__cta">
              <Wallet size={14} strokeWidth={2.25} aria-hidden />
              Add Money
            </Link>
          </section>
        )
      ) : null}

      <section className="wl-primary" aria-label="Verification types">
        <Link
          to={`${basePath}/verification?type=OV`}
          className="wl-primary__card wl-primary__card--ov"
          aria-label={`Original Verification, ${typeTally.OV} total`}
        >
          <span className="wl-primary__badge" aria-hidden>
            OV
          </span>
          <span className="wl-primary__body">
            <span className="wl-primary__stat-value">
              {loadingVerifications ? '—' : typeTally.OV}
            </span>
            <span className="wl-primary__sub">Original Verification</span>
          </span>
        </Link>
        <Link
          to={`${basePath}/verification?type=RV`}
          className="wl-primary__card wl-primary__card--rv"
          aria-label={`Re Verification, ${typeTally.RV} total`}
        >
          <span className="wl-primary__badge" aria-hidden>
            RV
          </span>
          <span className="wl-primary__body">
            <span className="wl-primary__stat-value">
              {loadingVerifications ? '—' : typeTally.RV}
            </span>
            <span className="wl-primary__sub">Re Verification</span>
          </span>
        </Link>
      </section>

      <section className="wl-stages-panel" aria-labelledby="wl-stages-title">
        <div className="wl-section__head">
          <h2 id="wl-stages-title" className="wl-section__title">
            Verification Stages
          </h2>
          <Link to={verificationHref()} className="wl-section__link">
            View All <ChevronRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="wl-stages">
          {stages.map(stage => (
            <Link
              key={stage.key}
              to={verificationHref(stage.key)}
              className={`wl-stage wl-stage--${stage.tone}`}
            >
              <span className="wl-stage__icon" aria-hidden>
                {stage.icon}
              </span>
              <span className="wl-stage__label">{stage.label}</span>
              <span className="wl-stage__count">
                {loadingVerifications ? '—' : stage.count}
              </span>
              <span className="wl-stage__bar" aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      <section className="wl-quick" aria-label="Quick stats">
        <Link to={verificationHref('draft')} className="wl-quick__card wl-quick__card--violet">
          <span className="wl-quick__icon" aria-hidden>
            <FilePenLine size={18} strokeWidth={2} />
          </span>
          <div className="wl-quick__body">
            <p className="wl-quick__label">Draft Verifications</p>
            <p className="wl-quick__value">{loadingVerifications ? '—' : tally.draft}</p>
            <p className="wl-quick__sub">Saved as draft</p>
          </div>
        </Link>
        <Link to={verificationHref('certified')} className="wl-quick__card wl-quick__card--orange">
          <span className="wl-quick__icon" aria-hidden>
            <BarChart3 size={18} strokeWidth={2} />
          </span>
          <div className="wl-quick__body">
            <p className="wl-quick__label">Certified This Month</p>
            <p className="wl-quick__value">{loadingVerifications ? '—' : certifiedMonth}</p>
            <p className="wl-quick__sub">Total certified</p>
          </div>
        </Link>
      </section>

      <section className="wl-section" aria-labelledby="wl-recent-title">
        <div className="wl-section__head">
          <h2 id="wl-recent-title" className="wl-section__title">
            Recent Verifications
          </h2>
          <Link to={verificationHref()} className="wl-section__link">
            View All <ChevronRight size={14} aria-hidden />
          </Link>
        </div>

        {loadingVerifications ? (
          <div className="wl-recent__loading">
            <span className="spinner-inline" aria-hidden />
          </div>
        ) : recent.length === 0 ? (
          <div className="wl-recent__empty">
            <p>No verification records yet.</p>
            <Link to={`${basePath}/verification?new=OV`} className="wl-wallet__cta">
              <Plus size={14} aria-hidden />
              New Verification
            </Link>
          </div>
        ) : (
          <ul className="wl-recent">
            {recent.map(record => {
              const typeLabel = record.verificationType === 'RV' ? 'RV' : 'OV';
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    className="wl-recent__card"
                    onClick={() => openRecord(record)}
                  >
                    <span className="wl-recent__status wl-recent__status--violet" aria-hidden>
                      <FileText size={20} strokeWidth={2} />
                    </span>
                    <span className="wl-recent__body">
                      <span className="wl-recent__top">
                        <span className="wl-recent__info">
                          <span className="wl-recent__name">
                            {record.customerName?.trim() || '—'}
                          </span>
                          <span className="wl-recent__id">{recordListId(record)}</span>
                        </span>
                        <span
                          className={`wl-recent__type${
                            typeLabel === 'RV' ? ' wl-recent__type--rv' : ''
                          }`}
                        >
                          {typeLabel}
                        </span>
                      </span>
                      <span className="wl-recent__footer">
                        <span>Serial: {record.serialNumber?.trim() || '—'}</span>
                        <span>Date: {formatVerificationListDate(record.createdAt)}</span>
                        <span>VCT: {record.vctName?.trim() || '—'}</span>
                      </span>
                    </span>
                    <ChevronRight className="wl-recent__chevron" size={18} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
