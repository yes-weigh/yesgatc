import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import {
  LayoutGrid,
  FileText,
  Send,
  Award,
  XCircle,
  BarChart3,
  ChevronRight,
  UploadCloud,
  Building2,
  CalendarDays,
  MapPin,
  Car,
  ShieldCheck,
  UserCircle,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { StorageImage } from '../../components/StorageImage';
import { db } from '../../firebase';
import {
  subscribeAutomationWorkerLogs,
  type AutomationWorkerLogEntry,
} from '../../lib/automationWorker';
import { LAST_CERTIFICATE_SEQUENCE_FLOOR } from '../../lib/certificateSequence';
import {
  displayEmaapText,
  EMAAP_SESSIONS_PATH,
  formatSessionStamp,
} from '../../lib/emaapSessionHistory';
import { isVctOperational } from '../../lib/vctApproval';
import { VctOfficerMark } from '../../components/VctOfficerMark';
import {
  rankRcsByCertifiedCount,
  saveRcCertificationRanks,
} from '../../lib/rcCertificationRank';
import { maxCertificateSequenceNumber } from '../../lib/verificationListSort';
import {
  getVerificationDisplayStatus,
  tallyVerificationStatusFilters,
  tallyVerificationTypeFilters,
  type VerificationStatusFilter,
} from '../../lib/verificationRequest';
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../../types';

type Period = 'lifetime' | 'year' | 'quarter' | 'month' | 'prevMonth' | 'custom';

type RcRow = {
  id: string;
  name: string;
  district: string;
  count: number;
  rank: number;
};

const PERIODS: { key: Period; label: string }[] = [
  { key: 'lifetime', label: 'Lifetime' },
  { key: 'year', label: 'This year' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'month', label: 'This month' },
  { key: 'prevMonth', label: 'Previous month' },
  { key: 'custom', label: 'Custom' },
];

function startOfQuarter(date: Date): Date {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function startOfPreviousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function endOfPreviousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function toInputDate(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function parseInputDate(value: string, end: boolean): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return end ? endOfDay(date) : startOfDay(date);
}

function recordCreatedAt(record: SiteCalibration): Date | null {
  if (!record.createdAt) return null;
  const date = new Date(record.createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function recordInPeriod(
  record: SiteCalibration,
  period: Period,
  customFrom: string,
  customTo: string,
): boolean {
  if (period === 'lifetime') return true;
  const created = recordCreatedAt(record);
  if (!created) return false;
  const now = new Date();
  if (period === 'year') {
    return created >= new Date(now.getFullYear(), 0, 1) && created <= now;
  }
  if (period === 'quarter') {
    return created >= startOfQuarter(now) && created <= now;
  }
  if (period === 'month') {
    return created >= new Date(now.getFullYear(), now.getMonth(), 1) && created <= now;
  }
  if (period === 'prevMonth') {
    return created >= startOfPreviousMonth(now) && created <= endOfPreviousMonth(now);
  }
  const from = parseInputDate(customFrom, false);
  const to = parseInputDate(customTo, true);
  if (from && created < from) return false;
  if (to && created > to) return false;
  return Boolean(from || to);
}

type StageTone = 'blue' | 'violet' | 'green' | 'red' | 'orange' | 'slate' | 'cyan';

type StageCard = {
  key: string;
  label: string;
  count?: number | string;
  sublabel?: string;
  tone: StageTone;
  icon: React.ReactNode;
  href: string;
};

function activityLevelIcon(level: string): React.ReactNode {
  if (level === 'error') return <XCircle size={16} strokeWidth={2.1} />;
  if (level === 'success') return <CheckCircle2 size={16} strokeWidth={2.1} />;
  return <Activity size={16} strokeWidth={2.1} />;
}

function certifiedInMonth(records: SiteCalibration[], offsetMonths: number): number {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const month = date.getMonth();
  const year = date.getFullYear();
  return records.filter(record => {
    if (getVerificationDisplayStatus(record) !== 'certified') return false;
    const raw = record.certifiedAt || record.approvedAt || record.createdAt;
    if (!raw) return false;
    const parsed = new Date(raw);
    return parsed.getMonth() === month && parsed.getFullYear() === year;
  }).length;
}

function districtKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function recordDistrict(
  record: SiteCalibration,
  customerDistrictById: Map<string, string>,
  rcDistrictById: Map<string, string>,
): string {
  if (record.verificationSubject === 'self') {
    return rcDistrictById.get(record.rcId?.trim() || '')?.trim() || '';
  }
  return customerDistrictById.get(record.customerId?.trim() || '')?.trim() || '';
}

const VERIFICATION_PATH = '/admin/verifications';

export const AdminDashboard: React.FC = () => {
  const [verifications, setVerifications] = useState<SiteCalibration[]>([]);
  const [rcUsers, setRcUsers] = useState<{ id: string; name: string; district: string }[]>([]);
  const [vctUsers, setVctUsers] = useState<
    { id: string; name: string; rcId: string; photoUrl?: string; photoPath?: string }[]
  >([]);
  const [vctTotal, setVctTotal] = useState(0);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [customerDistrictById, setCustomerDistrictById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [loadingVerifications, setLoadingVerifications] = useState(true);
  const [period, setPeriod] = useState<Period>('lifetime');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [activityLogs, setActivityLogs] = useState<AutomationWorkerLogEntry[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [calibrationSnap, userSnap, customerSnap, vehicleSnap] = await Promise.all([
        getDocs(collection(db, 'siteCalibrations')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'customers')),
        getDocs(collection(db, 'vehicles')),
      ]);
      const loaded = calibrationSnap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<SiteCalibration, 'id'>),
      }));
      setVerifications(loaded);
      const rcs: { id: string; name: string; district: string }[] = [];
      const vcts: {
        id: string;
        name: string;
        rcId: string;
        photoUrl?: string;
        photoPath?: string;
      }[] = [];
      let vctCount = 0;
      userSnap.docs.forEach(d => {
        const data = d.data() as FirestoreUserDoc;
        if (data.role === 'rc_admin') {
          rcs.push({
            id: d.id,
            name: data.companyName?.trim() || data.username?.trim() || '—',
            district: data.place?.trim() || '',
          });
          return;
        }
        if (data.role !== 'vct') return;
        vctCount += 1;
        if (!isVctOperational(data)) return;
        vcts.push({
          id: d.id,
          name: data.username?.trim() || data.contactPerson?.trim() || '—',
          rcId: data.rcId?.trim() || '',
          photoUrl: data.profilePhotoUrl?.trim() || undefined,
          photoPath: data.profilePhotoPath?.trim() || undefined,
        });
      });
      const districts = new Map<string, string>();
      customerSnap.docs.forEach(d => {
        const data = d.data() as Omit<Customer, 'id'>;
        const district = data.district?.trim();
        if (district) districts.set(d.id, district);
      });
      setRcUsers(rcs);
      setVctUsers(vcts);
      setVctTotal(vctCount);
      setVehicleCount(vehicleSnap.size);
      setCustomerDistrictById(districts);
      void saveRcCertificationRanks(rankRcsByCertifiedCount(loaded, rcs.map(rc => rc.id))).catch(
        () => undefined,
      );
      setLoadingVerifications(false);
    };
    void load();
  }, []);

  useEffect(
    () =>
      subscribeAutomationWorkerLogs(
        rows => {
          setActivityLogs(rows);
          setLoadingActivity(false);
        },
        () => setLoadingActivity(false),
        12,
      ),
    [],
  );

  const scopedVerifications = useMemo(
    () => verifications.filter(record => recordInPeriod(record, period, customFrom, customTo)),
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
  const lastCertificateNumber = useMemo(
    () =>
      Math.max(
        LAST_CERTIFICATE_SEQUENCE_FLOOR,
        maxCertificateSequenceNumber(verifications) ?? 0,
      ),
    [verifications],
  );

  const rcRows = useMemo<RcRow[]>(() => {
    const rcById = new Map(rcUsers.map(rc => [rc.id, rc]));
    return rankRcsByCertifiedCount(
      scopedVerifications,
      rcUsers.map(rc => rc.id),
    ).map((row, index) => ({
      id: row.rcId,
      name: rcById.get(row.rcId)?.name || 'Unknown RC',
      district: rcById.get(row.rcId)?.district || '—',
      count: row.certified,
      rank: index + 1,
    }));
  }, [scopedVerifications, rcUsers]);

  const stages = useMemo<StageCard[]>(
    () => [
      {
        key: 'submitted',
        label: 'Submitted',
        count: tally.submitted,
        tone: 'blue',
        icon: <Send size={18} strokeWidth={1.9} />,
        href: `${VERIFICATION_PATH}?status=submitted`,
      },
      {
        key: 'failed_submit',
        label: 'Failed at Submission',
        count: tally.failed_submit,
        tone: 'red',
        icon: <UploadCloud size={18} strokeWidth={1.9} />,
        href: `${VERIFICATION_PATH}?status=failed_submit`,
      },
      {
        key: 'draft',
        label: 'Draft',
        count: tally.draft,
        tone: 'violet',
        icon: <FileText size={18} strokeWidth={1.9} />,
        href: `${VERIFICATION_PATH}?status=draft`,
      },
      {
        key: 'certified',
        label: 'Certified',
        count: tally.certified,
        tone: 'green',
        icon: <Award size={18} strokeWidth={1.9} />,
        href: `${VERIFICATION_PATH}?status=certified`,
      },
      {
        key: 'rejected',
        label: 'Rejected',
        count: tally.rejected,
        tone: 'orange',
        icon: <XCircle size={18} strokeWidth={1.9} />,
        href: `${VERIFICATION_PATH}?status=rejected`,
      },
      {
        key: 'all',
        label: 'Total Certified',
        count: lastCertificateNumber,
        tone: 'blue',
        icon: <LayoutGrid size={18} strokeWidth={1.9} />,
        href: VERIFICATION_PATH,
      },
      {
        key: 'cars',
        label: 'Car',
        count: vehicleCount,
        tone: 'cyan',
        icon: <Car size={18} strokeWidth={1.9} />,
        href: '/admin/vehicles',
      },
      {
        key: 'vcts',
        label: 'VCT',
        count: vctTotal,
        tone: 'slate',
        icon: <VctOfficerMark />,
        href: '/admin/technicians',
      },
      {
        key: 'emaap',
        label: 'eMaap',
        sublabel: 'session logs',
        tone: 'green',
        icon: <ShieldCheck size={18} strokeWidth={1.9} />,
        href: EMAAP_SESSIONS_PATH,
      },
    ],
    [tally, lastCertificateNumber, vehicleCount, vctTotal],
  );

  const certifiedLastMonth = useMemo(() => certifiedInMonth(verifications, -1), [verifications]);
  const certifiedThisMonth = useMemo(() => certifiedInMonth(verifications, 0), [verifications]);

  const vctRows = useMemo(() => {
    const rcNameById = new Map(rcUsers.map(rc => [rc.id, rc.name]));
    const counts = new Map<string, number>();
    for (const record of scopedVerifications) {
      const id = record.vctId?.trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return vctUsers
      .map(vct => ({
        id: vct.id,
        name: vct.name,
        rcName: (vct.rcId && rcNameById.get(vct.rcId)) || '—',
        count: counts.get(vct.id) || 0,
        photoUrl: vct.photoUrl,
        photoPath: vct.photoPath,
      }))
      .filter(row => row.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [scopedVerifications, vctUsers, rcUsers]);

  const districtRows = useMemo(() => {
    const rcDistrictById = new Map(rcUsers.map(rc => [rc.id, rc.district]));
    const byKey = new Map<string, { name: string; count: number }>();
    for (const record of scopedVerifications) {
      const name = recordDistrict(record, customerDistrictById, rcDistrictById);
      if (!name) continue;
      const key = districtKey(name);
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byKey.set(key, { name, count: 1 });
      }
    }
    return [...byKey.values()]
      .filter(row => row.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [scopedVerifications, customerDistrictById, rcUsers]);

  const selectPeriod = (next: Period) => {
    setPeriod(next);
    if (next !== 'custom' || customFrom || customTo) return;
    const now = new Date();
    setCustomFrom(toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    setCustomTo(toInputDate(now));
  };

  const verificationHref = (status?: VerificationStatusFilter) => {
    if (status && status !== 'all') {
      return `${VERIFICATION_PATH}?status=${encodeURIComponent(status)}`;
    }
    return VERIFICATION_PATH;
  };

  return (
    <div className="fade-in wl-dash">
      <section className="wl-period-card" aria-label="Date range">
        <p className="wl-period-card__label">Period</p>
        <div className="wl-period" role="tablist" aria-label="Date range">
          {PERIODS.map(option => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={period === option.key}
              className={`wl-period__btn${period === option.key ? ' wl-period__btn--active' : ''}`}
              onClick={() => selectPeriod(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <div className="wl-period__custom">
            <label className="wl-period__field">
              <span>
                <CalendarDays size={12} aria-hidden />
                From
              </span>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={event => setCustomFrom(event.target.value)}
              />
            </label>
            <label className="wl-period__field">
              <span>
                <CalendarDays size={12} aria-hidden />
                To
              </span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={event => setCustomTo(event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section className="wl-primary" aria-label="Verification types">
        <Link
          to={`${VERIFICATION_PATH}?type=OV`}
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
          to={`${VERIFICATION_PATH}?type=RV`}
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

      <section className="wl-stages-panel" aria-labelledby="wl-admin-stages-title">
        <div className="wl-section__head">
          <h2 id="wl-admin-stages-title" className="wl-section__title">
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
              className={`wl-stage wl-stage--${stage.tone}${stage.sublabel ? ' wl-stage--wordmark' : ''}`}
            >
              <span className="wl-stage__icon" aria-hidden>
                {stage.icon}
              </span>
              <span className="wl-stage__label">{stage.label}</span>
              {stage.sublabel ? (
                <span className="wl-stage__sub">{stage.sublabel}</span>
              ) : (
                <span className="wl-stage__count">
                  {loadingVerifications ? '—' : stage.count}
                </span>
              )}
              <span className="wl-stage__bar" aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      <section className="wl-quick" aria-label="Quick stats">
        <Link to={verificationHref('certified')} className="wl-quick__card wl-quick__card--orange">
          <span className="wl-quick__icon" aria-hidden>
            <BarChart3 size={18} strokeWidth={2} />
          </span>
          <div className="wl-quick__body">
            <p className="wl-quick__label">Total Certified</p>
            <p className="wl-quick__value">{loadingVerifications ? '—' : certifiedLastMonth}</p>
            <p className="wl-quick__sub">Last month</p>
          </div>
        </Link>
        <Link to={verificationHref('certified')} className="wl-quick__card wl-quick__card--green">
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

      <section className="wl-section" aria-labelledby="wl-admin-rc-title">
        <div className="wl-section__head">
          <h2 id="wl-admin-rc-title" className="wl-section__title">
            Regional Centers
          </h2>
          <Link to="/admin/rc" className="wl-section__link">
            View All <ChevronRight size={14} aria-hidden />
          </Link>
        </div>
        {loadingVerifications ? (
          <div className="wl-recent__loading">
            <span className="spinner-inline" aria-hidden />
          </div>
        ) : rcRows.length === 0 ? (
          <div className="wl-recent__empty">
            <p>No regional centers yet.</p>
          </div>
        ) : (
          <ul className="wl-rc">
            {rcRows.map(rc => (
              <li key={rc.id}>
                <Link
                  to={`${VERIFICATION_PATH}?rc=${encodeURIComponent(rc.id)}`}
                  className="wl-rc__card"
                >
                  <span className="wl-rc__rank" aria-label={`Rank ${rc.rank}`}>
                    #{rc.rank}
                  </span>
                  <span className="wl-rc__icon" aria-hidden>
                    <Building2 size={18} strokeWidth={2} />
                  </span>
                  <span className="wl-rc__body">
                    <span className="wl-rc__name">{rc.name}</span>
                    <span className="wl-rc__meta">{rc.district}</span>
                  </span>
                  <span className="wl-rc__count">{rc.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wl-section" aria-labelledby="wl-admin-vct-title">
        <div className="wl-section__head">
          <h2 id="wl-admin-vct-title" className="wl-section__title">
            Verification Officer
          </h2>
          <Link to="/admin/technicians" className="wl-section__link">
            View All <ChevronRight size={14} aria-hidden />
          </Link>
        </div>
        {loadingVerifications ? (
          <div className="wl-recent__loading">
            <span className="spinner-inline" aria-hidden />
          </div>
        ) : vctRows.length === 0 ? (
          <div className="wl-recent__empty">
            <p>No verification officers with verifications.</p>
          </div>
        ) : (
          <ul className="wl-rc">
            {vctRows.map(vct => (
              <li key={vct.id}>
                <div className="wl-rc__card">
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
                    <span className="wl-rc__meta">{vct.rcName}</span>
                  </span>
                  <span className="wl-rc__count">{vct.count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wl-section" aria-labelledby="wl-admin-district-title">
        <div className="wl-section__head">
          <h2 id="wl-admin-district-title" className="wl-section__title">
            District-wise Verification
          </h2>
        </div>
        {loadingVerifications ? (
          <div className="wl-recent__loading">
            <span className="spinner-inline" aria-hidden />
          </div>
        ) : districtRows.length === 0 ? (
          <div className="wl-recent__empty">
            <p>No district verifications in this period.</p>
          </div>
        ) : (
          <ul className="wl-rc">
            {districtRows.map(district => (
              <li key={district.name}>
                <div className="wl-rc__card">
                  <span className="wl-rc__icon wl-rc__icon--district" aria-hidden>
                    <MapPin size={18} strokeWidth={2} />
                  </span>
                  <span className="wl-rc__body">
                    <span className="wl-rc__name">{district.name}</span>
                    <span className="wl-rc__meta">Total verifications</span>
                  </span>
                  <span className="wl-rc__count">{district.count}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wl-section" aria-labelledby="wl-admin-activity-title">
        <div className="wl-section__head">
          <h2 id="wl-admin-activity-title" className="wl-section__title">
            Activity Logs
          </h2>
          <Link to={EMAAP_SESSIONS_PATH} className="wl-section__link">
            View All <ChevronRight size={14} aria-hidden />
          </Link>
        </div>

        {loadingActivity ? (
          <div className="wl-recent__loading">
            <span className="spinner-inline" aria-hidden />
          </div>
        ) : activityLogs.length === 0 ? (
          <div className="wl-recent__empty">
            <p>No eMaap activity yet.</p>
          </div>
        ) : (
          <ul className="wl-activity">
            {activityLogs.map(entry => (
              <li key={entry.id}>
                <Link to={EMAAP_SESSIONS_PATH} className={`wl-activity__card wl-activity__card--${entry.level}`}>
                  <span className="wl-activity__icon" aria-hidden>
                    {activityLevelIcon(entry.level)}
                  </span>
                  <span className="wl-activity__body">
                    <span className="wl-activity__msg">{displayEmaapText(entry.message)}</span>
                    <span className="wl-activity__meta">
                      {formatSessionStamp(entry.createdAt)}
                      {entry.machineName ? ` · ${entry.machineName}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
