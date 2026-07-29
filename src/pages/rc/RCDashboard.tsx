import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import {
  Wallet,
  LayoutGrid,
  FileText,
  Send,
  ShieldCheck,
  Award,
  XCircle,
  FilePenLine,
  BarChart3,
  Plus,
  ScanLine,
  Search,
  RefreshCw,
  Download,
  ChevronRight,
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
  canDownloadVerificationCertificate,
  getVerificationDisplayStatus,
  sanitizeVerificationDisplayText,
  tallyVerificationStatusFilters,
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

function statusIconTone(record: SiteCalibration): StageTone {
  const status = getVerificationDisplayStatus(record);
  if (status === 'draft') return 'violet';
  if (status === 'submitted' || status === 'approved') return 'blue';
  if (status === 'certified') return 'green';
  if (status === 'rejected') return 'orange';
  return 'red';
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
  const [refreshing, setRefreshing] = useState(false);

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

  const stages = useMemo<StageCard[]>(
    () => [
      {
        key: 'all',
        label: 'All Stages',
        count: tally.all,
        tone: 'blue',
        icon: <LayoutGrid size={20} strokeWidth={1.9} />,
      },
      {
        key: 'draft',
        label: 'Draft',
        count: tally.draft,
        tone: 'violet',
        icon: <FileText size={20} strokeWidth={1.9} />,
      },
      {
        key: 'submitted',
        label: 'Submitted',
        count: tally.submitted,
        tone: 'blue',
        icon: <Send size={20} strokeWidth={1.9} />,
      },
      {
        key: 'certified',
        label: 'Certified',
        count: tally.certified,
        tone: 'green',
        icon: <Award size={20} strokeWidth={1.9} />,
      },
      {
        key: 'failed_submit',
        label: 'Failed at Submit',
        count: tally.failed_submit,
        tone: 'red',
        icon: <XCircle size={20} strokeWidth={1.9} />,
      },
      {
        key: 'rejected',
        label: 'Rejected',
        count: tally.rejected,
        tone: 'orange',
        icon: <XCircle size={20} strokeWidth={1.9} />,
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

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchVerifications();
    } finally {
      setRefreshing(false);
    }
  };

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
              className={`wl-stage wl-stage--${stage.tone}${
                stage.key === 'draft' ? ' wl-stage--draft' : ''
              }`}
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
            <p className="wl-quick__label">Verifications · Draft</p>
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
            <Link to={`${basePath}/verification`} className="wl-wallet__cta">
              <Plus size={14} aria-hidden />
              New Verification
            </Link>
          </div>
        ) : (
          <ul className="wl-recent">
            {recent.map(record => {
              const tone = statusIconTone(record);
              const showDownload = canDownloadVerificationCertificate(record);
              return (
                <li key={record.id}>
                  <article className={`wl-recent__card wl-recent__card--${tone}`}>
                    <div className="wl-recent__main">
                      <button
                        type="button"
                        className="wl-recent__open"
                        onClick={() => openRecord(record)}
                      >
                        <span className={`wl-recent__status wl-recent__status--${tone}`} aria-hidden>
                          {tone === 'violet' ? (
                            <FileText size={20} strokeWidth={2} />
                          ) : tone === 'red' || tone === 'orange' ? (
                            <XCircle size={20} strokeWidth={2} />
                          ) : (
                            <ShieldCheck size={20} strokeWidth={2} />
                          )}
                        </span>
                        <span className="wl-recent__info">
                          <span className="wl-recent__name">
                            {record.customerName?.trim() || '—'}
                          </span>
                          <span className="wl-recent__id">{recordListId(record)}</span>
                        </span>
                      </button>
                      <span className="wl-recent__meta-right">
                        <span
                          className={`wl-recent__type${
                            record.verificationType === 'RV' ? ' wl-recent__type--rv' : ''
                          }`}
                        >
                          {record.verificationType === 'RV' ? 'RV' : 'OV'}
                        </span>
                        {showDownload && record.certificatePdfUrl ? (
                          <a
                            className="wl-recent__download"
                            href={record.certificatePdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Download certificate"
                            title="Download certificate"
                          >
                            <Download size={16} strokeWidth={2.25} />
                          </a>
                        ) : null}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="wl-recent__footer"
                      onClick={() => openRecord(record)}
                    >
                      <span>Serial: {record.serialNumber?.trim() || '—'}</span>
                      <span>Date: {formatVerificationListDate(record.createdAt)}</span>
                      <span>VCT: {record.vctName?.trim() || '—'}</span>
                    </button>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav className="wl-actions" aria-label="Dashboard quick actions">
        <Link to={`${basePath}/verification`} className="wl-actions__btn wl-actions__btn--violet">
          <span className="wl-actions__icon" aria-hidden>
            <Plus size={20} strokeWidth={2.4} />
          </span>
          <span>New Verification</span>
        </Link>
        <Link to={`${basePath}/verification`} className="wl-actions__btn wl-actions__btn--blue">
          <span className="wl-actions__icon" aria-hidden>
            <ScanLine size={20} strokeWidth={2.2} />
          </span>
          <span>Scan QR / Label</span>
        </Link>
        <Link
          to={`${basePath}/verification?focus=search`}
          className="wl-actions__btn wl-actions__btn--green"
        >
          <span className="wl-actions__icon" aria-hidden>
            <Search size={20} strokeWidth={2.2} />
          </span>
          <span>Search Verification</span>
        </Link>
        <button
          type="button"
          className="wl-actions__btn wl-actions__btn--orange"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
        >
          <span className={`wl-actions__icon${refreshing ? ' wl-actions__icon--spin' : ''}`} aria-hidden>
            <RefreshCw size={20} strokeWidth={2.2} />
          </span>
          <span>{refreshing ? 'Syncing…' : 'Sync / Refresh'}</span>
        </button>
      </nav>
    </div>
  );
};
