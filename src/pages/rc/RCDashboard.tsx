import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, getDoc, getDocs } from 'firebase/firestore';
import {
  Wallet,
  LayoutGrid,
  FileText,
  Send,
  Award,
  XCircle,
  BarChart3,
  Plus,
  ChevronRight,
  UploadCloud,
  Car,
  Trophy,
  UserCircle,
} from 'lucide-react';
import { RcVehicleRequiredNotice } from '../../components/RcVehicleRequiredNotice';
import { DashboardPeriodFilter } from '../../components/DashboardPeriodFilter';
import {
  recordActivityStamp,
  recordInDashboardPeriod,
  type DashboardPeriod,
} from '../../lib/dashboardPeriod';
import { StorageImage } from '../../components/StorageImage';
import { VctOfficerMark } from '../../components/VctOfficerMark';
import { db } from '../../firebase';
import { fetchRcVehicles, rcHasRegisteredVehicle } from '../../lib/rcVehicles';
import { fetchRcVctUsers } from '../../lib/rcVctMembers';
import { rankOfRc, subscribeRcCertificationRanks } from '../../lib/rcCertificationRank';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';
import { subscribeRcWalletBalance, subscribeWalletTopUps } from '../../lib/rcWallet';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { useRoleBasePath, useRcScope } from '../../lib/roleScope';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import {
  dashboardPeriodToListDuration,
  verificationListPath,
  type VerificationDurationFilter,
} from '../../lib/verificationListDuration';
import {
  getVerificationDisplayStatus,
  sanitizeVerificationDisplayText,
  tallyVerificationStatusFilters,
  tallyVerificationTypeFilters,
  type VerificationStatusFilter,
} from '../../lib/verificationRequest';
import type { FirestoreUserDoc, SiteCalibration } from '../../types';

type StageTone = 'blue' | 'violet' | 'green' | 'red' | 'orange' | 'slate' | 'cyan';

type StageCard = {
  key: string;
  label: string;
  count: number | string;
  tone: StageTone;
  icon: React.ReactNode;
  href: string;
  sublabel?: string;
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

function certifiedInMonth(records: SiteCalibration[], offsetMonths: number): number {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const month = date.getMonth();
  const year = date.getFullYear();
  return records.filter(record => {
    if (getVerificationDisplayStatus(record) !== 'certified') return false;
    const stamp = recordActivityStamp(record);
    if (!Number.isFinite(stamp)) return false;
    const parsed = new Date(stamp);
    return parsed.getMonth() === month && parsed.getFullYear() === year;
  }).length;
}

type VctDashProfile = {
  name: string;
  phone?: string;
  photoUrl?: string;
  photoPath?: string;
};

type VctCertRow = {
  id: string;
  name: string;
  phone?: string;
  count: number;
  photoUrl?: string;
  photoPath?: string;
};

function rankVctsByCertified(
  records: SiteCalibration[],
  profiles: Map<string, VctDashProfile>,
): VctCertRow[] {
  const rows = new Map<string, VctCertRow>();
  for (const record of records) {
    if (getVerificationDisplayStatus(record) !== 'certified') continue;
    const id = record.vctId?.trim();
    if (!id) continue;
    const profile = profiles.get(id);
    const prev = rows.get(id);
    const name = profile?.name || prev?.name || record.vctName?.trim() || 'VCT';
    rows.set(id, {
      id,
      name: name === 'VCT' && record.vctName?.trim() ? record.vctName.trim() : name,
      phone: profile?.phone || prev?.phone,
      count: (prev?.count || 0) + 1,
      photoUrl: profile?.photoUrl || prev?.photoUrl,
      photoPath: profile?.photoPath || prev?.photoPath,
    });
  }
  return [...rows.values()]
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
  const [vehicleCount, setVehicleCount] = useState(0);
  const [vctCount, setVctCount] = useState(0);
  const [vctById, setVctById] = useState<Map<string, VctDashProfile>>(() => new Map());
  const [rcRank, setRcRank] = useState<number | null>(null);
  const [rcCompanyName, setRcCompanyName] = useState('');
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

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
    if (!rcUid) {
      setVehicleCount(0);
      setVctCount(0);
      setVctById(new Map());
      setRcHasVehicle(null);
      return;
    }
    let cancelled = false;
    void Promise.all([fetchRcVehicles(rcUid), fetchRcVctUsers(rcUid)]).then(([vehicles, vcts]) => {
      if (cancelled) return;
      setVehicleCount(vehicles.length);
      setVctCount(vcts.length);
      setVctById(
        new Map(
          vcts.map(vct => [
            vct.uid,
            {
              name: vct.username?.trim() || vct.uid,
              phone: vct.phone?.trim() || undefined,
              photoUrl: vct.profilePhotoUrl?.trim() || undefined,
              photoPath: vct.profilePhotoPath?.trim() || undefined,
            },
          ]),
        ),
      );
      if (isRcAdmin) setRcHasVehicle(rcHasRegisteredVehicle(vehicles));
    });
    return () => {
      cancelled = true;
    };
  }, [rcUid, isRcAdmin]);

  useEffect(() => {
    if (!rcUid) {
      setRcRank(null);
      setRcCompanyName('');
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, 'users', rcUid)).then(snap => {
      if (cancelled || !snap.exists()) return;
      const data = snap.data() as FirestoreUserDoc;
      setRcCompanyName(data.companyName?.trim() || data.username?.trim() || '');
    });
    const unsub = subscribeRcCertificationRanks(ranks => {
      setRcRank(rankOfRc(ranks, rcUid));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [rcUid]);

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

  const scopedVerifications = useMemo(
    () =>
      verifications.filter(record =>
        recordInDashboardPeriod(record, period, customFrom, customTo),
      ),
    [verifications, period, customFrom, customTo],
  );
  const tally = useMemo(
    () => tallyVerificationStatusFilters(scopedVerifications),
    [scopedVerifications],
  );
  const typeTally = useMemo(
    () => tallyVerificationTypeFilters(scopedVerifications),
    [scopedVerifications],
  );
  const lifetimeCertified = useMemo(
    () => tallyVerificationStatusFilters(verifications).certified,
    [verifications],
  );
  const listDuration = dashboardPeriodToListDuration(period);

  const verificationHref = (
    status?: VerificationStatusFilter,
    duration: VerificationDurationFilter = listDuration,
  ) =>
    verificationListPath(`${basePath}/verification`, { status, duration });

  const stages = useMemo<StageCard[]>(
    () => [
      {
        key: 'submitted',
        label: 'Submitted',
        count: tally.submitted,
        tone: 'blue',
        icon: <Send size={18} strokeWidth={1.9} />,
        href: verificationHref('submitted'),
      },
      {
        key: 'failed_submit',
        label: 'Failed at Submission',
        count: tally.failed_submit,
        tone: 'red',
        icon: <UploadCloud size={18} strokeWidth={1.9} />,
        href: verificationHref('failed_submit'),
      },
      {
        key: 'draft',
        label: 'Draft',
        count: tally.draft,
        tone: 'violet',
        icon: <FileText size={18} strokeWidth={1.9} />,
        href: verificationHref('draft'),
      },
      {
        key: 'certified',
        label: 'Certified',
        count: tally.certified,
        tone: 'green',
        icon: <Award size={18} strokeWidth={1.9} />,
        href: verificationHref('certified'),
      },
      {
        key: 'rejected',
        label: 'Rejected',
        count: tally.rejected,
        tone: 'orange',
        icon: <XCircle size={18} strokeWidth={1.9} />,
        href: verificationHref('rejected'),
      },
      {
        key: 'total_certified',
        label: 'Total Certified',
        count: lifetimeCertified,
        tone: 'blue',
        icon: <LayoutGrid size={18} strokeWidth={1.9} />,
        href: verificationHref('certified', 'all'),
      },
      {
        key: 'cars',
        label: 'Car',
        count: vehicleCount,
        tone: 'cyan',
        icon: <Car size={18} strokeWidth={1.9} />,
        href: `${basePath}/vehicles`,
      },
      {
        key: 'vcts',
        label: 'VCT',
        count: vctCount,
        tone: 'slate',
        icon: <VctOfficerMark />,
        href: isRcAdmin ? `${basePath}/vct` : verificationHref(),
      },
      {
        key: 'rc_rank',
        label: 'RC Ranking',
        count: rcRank != null ? `#${rcRank}` : '—',
        sublabel: rcCompanyName || undefined,
        tone: 'blue',
        icon: <Trophy size={18} strokeWidth={1.9} />,
        href: verificationHref('certified'),
      },
    ],
    [tally, lifetimeCertified, vehicleCount, vctCount, rcRank, rcCompanyName, isRcAdmin, basePath, listDuration],
  );

  const recent = useMemo(
    () =>
      [...scopedVerifications]
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 6),
    [scopedVerifications],
  );

  const walletSub = isVct
    ? 'Shared RC centre wallet for RV fees'
    : pendingTopUps > 0
      ? `${pendingTopUps} top-up${pendingTopUps === 1 ? '' : 's'} awaiting approval`
      : 'Add payment screenshot to top up';

  const certifiedLastMonth = useMemo(() => certifiedInMonth(verifications, -1), [verifications]);
  const certifiedThisMonth = useMemo(() => certifiedInMonth(verifications, 0), [verifications]);
  const vctCertRows = useMemo(
    () => rankVctsByCertified(scopedVerifications, vctById),
    [scopedVerifications, vctById],
  );

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
          to={verificationListPath(`${basePath}/verification`, { type: 'OV', duration: listDuration })}
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
          </span>
        </Link>
        <Link
          to={verificationListPath(`${basePath}/verification`, { type: 'RV', duration: listDuration })}
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
          </span>
        </Link>
        <DashboardPeriodFilter
          period={period}
          customFrom={customFrom}
          customTo={customTo}
          onPeriodChange={setPeriod}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
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
              to={stage.href}
              className={`wl-stage wl-stage--${stage.tone}`}
            >
              <span className="wl-stage__icon" aria-hidden>
                {stage.icon}
              </span>
              <span className="wl-stage__label">{stage.label}</span>
              <span className="wl-stage__count">
                {loadingVerifications ? '—' : stage.count}
              </span>
              {stage.sublabel ? (
                <span className={`wl-stage__sub${stage.key === 'rc_rank' ? ' wl-stage__sub--name' : ''}`}>
                  {stage.sublabel}
                </span>
              ) : null}
              <span className="wl-stage__bar" aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      <section className="wl-quick" aria-label="Quick stats">
        <Link
          to={verificationHref('certified', 'prevMonth')}
          className="wl-quick__card wl-quick__card--orange"
        >
          <span className="wl-quick__icon" aria-hidden>
            <BarChart3 size={18} strokeWidth={2} />
          </span>
          <div className="wl-quick__body">
            <p className="wl-quick__label">Total Certified</p>
            <p className="wl-quick__value">{loadingVerifications ? '—' : certifiedLastMonth}</p>
            <p className="wl-quick__sub">Last month</p>
          </div>
        </Link>
        <Link
          to={verificationHref('certified', 'month')}
          className="wl-quick__card wl-quick__card--green"
        >
          <span className="wl-quick__icon" aria-hidden>
            <Award size={18} strokeWidth={2} />
          </span>
          <div className="wl-quick__body">
            <p className="wl-quick__label">Total Certified</p>
            <p className="wl-quick__value">{loadingVerifications ? '—' : certifiedThisMonth}</p>
            <p className="wl-quick__sub">This month</p>
          </div>
        </Link>
      </section>

      <section className="wl-section" aria-labelledby="wl-vct-cert-title">
        <div className="wl-section__head">
          <h2 id="wl-vct-cert-title" className="wl-section__title">
            Verification Officer
          </h2>
          {isRcAdmin ? (
            <Link to={`${basePath}/vct`} className="wl-section__link">
              View All <ChevronRight size={14} aria-hidden />
            </Link>
          ) : null}
        </div>
        {loadingVerifications ? (
          <div className="wl-recent__loading">
            <span className="spinner-inline" aria-hidden />
          </div>
        ) : vctCertRows.length === 0 ? (
          <div className="wl-recent__empty">
            <p>No VCT certifications yet.</p>
          </div>
        ) : (
          <ul className="wl-rc">
            {vctCertRows.map(vct => (
              <li key={vct.id}>
                <Link
                  to={verificationHref('certified')}
                  className="wl-rc__card"
                >
                  <span className="wl-rc__photo" aria-hidden>
                    {vct.photoUrl || vct.photoPath ? (
                      <StorageImage url={vct.photoUrl} path={vct.photoPath} alt="" />
                    ) : (
                      <span className="wl-rc__photo-fallback">
                        <UserCircle size={22} strokeWidth={1.6} />
                      </span>
                    )}
                  </span>
                  <span className="wl-rc__body">
                    <span className="wl-rc__name">{vct.name}</span>
                    {vct.phone ? <span className="wl-rc__meta">{vct.phone}</span> : null}
                  </span>
                  <span className="wl-rc__count">{vct.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
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
