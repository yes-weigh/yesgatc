import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  KeyRound,
  ListFilter,
  ScanLine,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { TablePagination } from '../../components/TablePagination';
import {
  EMAAP_HISTORY_CAPTCHA_LIMIT,
  EMAAP_HISTORY_LOG_LIMIT,
  EMAAP_HISTORY_SESSION_LIMIT,
  fetchAutomationWorkerCaptchaAttemptsInRange,
  fetchAutomationWorkerLogsInRange,
  formatDuration,
  subscribeAutomationWorkerCaptchaAttempts,
  subscribeAutomationWorkerLogs,
  subscribeAutomationWorkerSessions,
  subscribeAutomationWorkerStatus,
  type AutomationWorkerCaptchaAttempt,
  type AutomationWorkerLogEntry,
  type AutomationWorkerSessionEvent,
  type AutomationWorkerStatus,
} from '../../lib/automationWorker';
import {
  buildEmaapSessionHistory,
  displayEmaapText,
  emaapPeriodRange,
  EMAAP_SESSION_PAGE_SIZE,
  EMAAP_SESSIONS_PATH,
  exportEmaapSessionsCsv,
  filterEmaapSessions,
  formatHeartbeatAge,
  formatLogoutReason,
  formatSessionDateTime,
  formatSessionStamp,
  formatSessionTime,
  tallyEmaapDurationLast24h,
  tallyEmaapSessionFilters,
  type EmaapPeriodFilter,
  type EmaapSessionFilter,
  type EmaapSessionRecord,
  type EmaapSessionTab,
} from '../../lib/emaapSessionHistory';
import { clampPage, paginateItems } from '../../lib/tablePagination';

const PERIODS: { id: EmaapPeriodFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

const STATUS_FILTERS: { id: EmaapSessionFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'Success' },
  { id: 'failed', label: 'Failed' },
];

const TABS: { id: EmaapSessionTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'logs', label: 'Logs' },
];

function statusIcon(status: EmaapSessionRecord['status']) {
  if (status === 'failed') return <XCircle size={18} strokeWidth={2.1} />;
  if (status === 'active') return <Clock3 size={18} strokeWidth={2.1} />;
  return <CheckCircle2 size={18} strokeWidth={2.1} />;
}

function formatTotalDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  return formatDuration(seconds);
}

function mergeById<T extends { id: string }>(incoming: T[], current: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function sessionWindowKey(row: Pick<EmaapSessionRecord, 'id' | 'startedAt' | 'endedAt'>): string {
  return `${row.id}:${row.startedAt}:${row.endedAt}`;
}

function statusLabel(status: EmaapSessionRecord['status']) {
  if (status === 'active') return 'Active';
  if (status === 'failed') return 'Failed';
  return 'Success';
}

function SessionCard({ row }: { row: EmaapSessionRecord }) {
  const failed = row.status === 'failed';
  const firstLabel = failed ? 'Logout' : 'Started';
  const secondLabel = failed ? 'Login' : 'Ended';
  const firstValue = failed
    ? row.endedAt
      ? formatSessionStamp(row.endedAt)
      : '—'
    : formatSessionStamp(row.startedAt);
  const secondValue = failed
    ? row.nextStartedAt
      ? formatSessionStamp(row.nextStartedAt)
      : row.startedAt
        ? formatSessionStamp(row.startedAt)
        : '—'
    : row.endedAt
      ? formatSessionStamp(row.endedAt)
      : '—';
  const durationValue = failed && row.downtimeSeconds != null
    ? formatDuration(row.downtimeSeconds)
    : formatDuration(row.durationSeconds);

  return (
    <Link to={`${EMAAP_SESSIONS_PATH}/${row.id}`} className={`esl-card esl-card--${row.status}`}>
      <div className="esl-card__top">
        <span className="esl-card__icon" aria-hidden>
          {statusIcon(row.status)}
        </span>
        <strong className="esl-card__id">{row.displayId}</strong>
        <span className={`esl-badge esl-badge--${row.status}`}>{statusLabel(row.status)}</span>
        <ChevronRight size={16} className="esl-card__chevron" aria-hidden />
      </div>
      <div className="esl-card__times">
        <span>
          <small>{firstLabel}</small>
          {firstValue}
        </span>
        <span>
          <small>{secondLabel}</small>
          {secondValue}
        </span>
        <span>
          <small>Duration</small>
          {durationValue}
        </span>
      </div>
      <div className="esl-card__stats">
        <span title="Jobs"><Briefcase size={13} /> {row.jobs}</span>
        <span title="Certified"><CheckCircle2 size={13} /> {row.certified}</span>
        <span title="Failed"><XCircle size={13} /> {row.failed}</span>
        <span title="OCR"><ScanLine size={13} /> {row.ocr}</span>
        <span title="OTP"><KeyRound size={13} /> {row.otp}</span>
      </div>
      <div className="esl-card__foot">
        <span>{row.machineName || 'VPS'}</span>
        <span className={row.emaapLoggedIn ? 'esl-ok' : 'esl-bad'}>
          {row.emaapLoggedIn ? 'eMAAP Logged in' : 'Login required'}
        </span>
        <span>{row.workerName}</span>
      </div>
    </Link>
  );
}

export const AdminEmaapSessionLogs: React.FC = () => {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const [status, setStatus] = useState<AutomationWorkerStatus | null>(null);
  const [events, setEvents] = useState<AutomationWorkerSessionEvent[]>([]);
  const [logs, setLogs] = useState<AutomationWorkerLogEntry[]>([]);
  const [captcha, setCaptcha] = useState<AutomationWorkerCaptchaAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EmaapSessionFilter>('all');
  const [period, setPeriod] = useState<EmaapPeriodFilter>('month');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<EmaapSessionTab>('overview');
  const filterRef = useRef<HTMLDivElement>(null);

  const hydratedWindows = useRef(new Set<string>());
  const inflightWindows = useRef(new Set<string>());

  const selectPeriod = (next: EmaapPeriodFilter) => {
    setPeriod(next);
    if (next !== 'custom' || customFrom || customTo) return;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (date: Date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    setCustomFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
    setCustomTo(iso(now));
  };

  useEffect(() => subscribeAutomationWorkerStatus(setStatus), []);

  useEffect(
    () =>
      subscribeAutomationWorkerSessions(
        rows => {
          setEvents(rows);
          setLoading(false);
        },
        () => setLoading(false),
        EMAAP_HISTORY_SESSION_LIMIT,
      ),
    [],
  );

  const activitySince = useMemo(() => {
    let oldest = status?.docaLoggedInAt || '';
    for (const event of events) {
      if (event.loggedInAt && (!oldest || event.loggedInAt < oldest)) oldest = event.loggedInAt;
    }
    return oldest || undefined;
  }, [events, status?.docaLoggedInAt]);

  useEffect(
    () =>
      subscribeAutomationWorkerLogs(
        rows => setLogs(current => mergeById(rows, current)),
        undefined,
        EMAAP_HISTORY_LOG_LIMIT,
        activitySince,
      ),
    [activitySince],
  );

  useEffect(
    () =>
      subscribeAutomationWorkerCaptchaAttempts(
        rows => setCaptcha(current => mergeById(rows, current)),
        undefined,
        EMAAP_HISTORY_CAPTCHA_LIMIT,
        activitySince,
      ),
    [activitySince],
  );

  const records = useMemo(
    () => buildEmaapSessionHistory(events, logs, captcha, status),
    [events, logs, captcha, status],
  );
  const { from, to } = useMemo(
    () => emaapPeriodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );
  const scoped = useMemo(
    () => filterEmaapSessions(records, 'all', search, from, to),
    [records, search, from, to],
  );
  const filtered = useMemo(
    () => (filter === 'all' ? scoped : scoped.filter(row => row.status === filter)),
    [scoped, filter],
  );
  const durationTotals = useMemo(() => tallyEmaapDurationLast24h(records), [records]);
  const successPct = useMemo(() => {
    const total = durationTotals.success + durationTotals.failed;
    if (total <= 0) return 0;
    return Math.round((durationTotals.success / total) * 100);
  }, [durationTotals]);
  const counts = useMemo(() => tallyEmaapSessionFilters(scoped), [scoped]);
  const paged = useMemo(
    () => paginateItems(filtered, page, EMAAP_SESSION_PAGE_SIZE),
    [filtered, page],
  );
  const selected = sessionId ? records.find(row => row.id === sessionId) : undefined;

  useEffect(() => {
    setPage(1);
  }, [filter, search, from, to]);

  useEffect(() => {
    setPage(current => clampPage(current, Math.max(1, Math.ceil(filtered.length / EMAAP_SESSION_PAGE_SIZE))));
  }, [filtered.length]);

  useEffect(() => {
    setTab('overview');
  }, [sessionId]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (filterRef.current?.contains(event.target as Node)) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  useEffect(() => {
    const targets = (selected ? [selected] : paged).filter(
      row => !row.id.startsWith('gap--') && row.startedAt && row.logs.length === 0,
    );
    const pending = targets.filter(row => {
      const key = sessionWindowKey(row);
      return !hydratedWindows.current.has(key) && !inflightWindows.current.has(key);
    });
    if (pending.length === 0) return;
    const nowIso = new Date().toISOString();
    for (const row of pending) inflightWindows.current.add(sessionWindowKey(row));
    void Promise.all(
      pending.map(async row => {
        const key = sessionWindowKey(row);
        const until = row.endedAt || nowIso;
        try {
          const [windowLogs, windowCaptcha] = await Promise.all([
            fetchAutomationWorkerLogsInRange(row.startedAt, until),
            fetchAutomationWorkerCaptchaAttemptsInRange(row.startedAt, until),
          ]);
          if (windowLogs.length) setLogs(current => mergeById(windowLogs, current));
          if (windowCaptcha.length) setCaptcha(current => mergeById(windowCaptcha, current));
        } finally {
          inflightWindows.current.delete(key);
          hydratedWindows.current.add(key);
        }
      }),
    );
  }, [paged, selected]);

  if (sessionId && !loading && !selected) {
    return (
      <div className="fade-in page-content esl-page">
        <ListViewBackBar onBack={() => navigate(EMAAP_SESSIONS_PATH)} label="Back to session logs" />
        <p className="esl-empty">Session not found.</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="fade-in page-content esl-page">
        <ListViewBackBar onBack={() => navigate(EMAAP_SESSIONS_PATH)} label="Back to session logs" />
        <header className={`esl-detail-head esl-detail-head--${selected.status}`}>
          <span className="esl-detail-head__icon" aria-hidden>
            {statusIcon(selected.status)}
          </span>
          <div className="esl-detail-head__copy">
            <p className="esl-detail-head__id">{selected.displayId}</p>
            <p className="esl-detail-head__meta">
              {formatSessionDateTime(selected.startedAt)}
              <span>·</span>
              {formatDuration(selected.durationSeconds)}
              <span>·</span>
              {selected.workerName}
            </p>
          </div>
          <span className={`esl-badge esl-badge--${selected.status}`}>{statusLabel(selected.status)}</span>
        </header>

        <div className="esl-tabs" role="tablist">
          {TABS.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`esl-tab${tab === item.id ? ' esl-tab--active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.id === 'jobs' ? `Jobs (${selected.jobs})` : item.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <section className="esl-panel">
              <h2 className="esl-panel__title">Session Overview</h2>
              <dl className="esl-kv">
                <div><dt>Machine</dt><dd>{selected.machineName || 'VPS'}</dd></div>
                <div><dt>Worker</dt><dd>{selected.workerName}</dd></div>
                <div>
                  <dt>eMAAP Status</dt>
                  <dd className={selected.emaapLoggedIn ? 'esl-ok' : 'esl-bad'}>
                    {selected.emaapLoggedIn ? 'Logged in' : 'Login required'}
                  </dd>
                </div>
                <div><dt>Started</dt><dd>{formatSessionDateTime(selected.startedAt)}</dd></div>
                <div>
                  <dt>Ended</dt>
                  <dd className="esl-bad">
                    {selected.endedAt ? formatSessionDateTime(selected.endedAt) : 'In progress'}
                  </dd>
                </div>
                <div>
                  <dt>Heartbeat</dt>
                  <dd>{selected.heartbeatAt ? formatHeartbeatAge(selected.heartbeatAt) : '—'}</dd>
                </div>
                {selected.downtimeSeconds != null && selected.nextStartedAt ? (
                  <>
                    <div>
                      <dt>Next login</dt>
                      <dd>{formatSessionDateTime(selected.nextStartedAt)}</dd>
                    </div>
                    <div>
                      <dt>Downtime</dt>
                      <dd className="esl-bad">{formatDuration(selected.downtimeSeconds)}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </section>

            <section className="esl-panel">
              <h2 className="esl-panel__title">Summary</h2>
              <div className="esl-summary">
                <article><p>Total Jobs</p><strong>{selected.jobs}</strong></article>
                <article className="esl-summary--ok"><p>Certified</p><strong>{selected.certified}</strong></article>
                <article className="esl-summary--bad"><p>Failed</p><strong>{selected.failed}</strong></article>
                <article><p>Captcha OCR</p><strong>{selected.ocr}</strong></article>
                <article><p>OTP Submitted</p><strong>{selected.otp}</strong></article>
                <article><p>Retries</p><strong>{selected.retries}</strong></article>
              </div>
            </section>

            {selected.status === 'failed' && (
              <section className="esl-fail">
                <h2>Error</h2>
                <p>{selected.errorMessage || formatLogoutReason(selected.logoutReason)}</p>
                {selected.failedAt ? <p className="esl-fail__meta">Failed at {formatSessionDateTime(selected.failedAt)}</p> : null}
                {selected.failedJobLabel ? <p className="esl-fail__meta">Failed on {selected.failedJobLabel}</p> : null}
              </section>
            )}

            <button type="button" className="esl-tech" onClick={() => setTab('logs')}>
              View Technical Log
              <ArrowRight size={16} aria-hidden />
            </button>
          </>
        )}

        {tab === 'timeline' && (
          <section className="esl-panel">
            {selected.logs.length === 0 ? (
              <p className="esl-empty">No timeline events in this session window.</p>
            ) : (
              <ol className="esl-timeline">
                {selected.logs.map(entry => (
                  <li key={entry.id} className={`esl-timeline__item esl-timeline__item--${entry.level}`}>
                    <time>{formatSessionTime(entry.createdAt)}</time>
                    <p>{displayEmaapText(entry.message)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {tab === 'jobs' && (
          <section className="esl-panel">
            {selected.jobRows.length === 0 ? (
              <p className="esl-empty">No job identifiers captured in logs for this session.</p>
            ) : (
              <ul className="esl-jobs">
                {selected.jobRows.map((job, index) => (
                  <li key={`${job.certificateNumber}-${index}`} className={job.ok ? 'esl-jobs__ok' : 'esl-jobs__bad'}>
                    <strong>{job.label}</strong>
                    <span>{job.certificateNumber || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'logs' && (
          <section className="esl-panel esl-panel--terminal">
            {selected.logs.length === 0 ? (
              <p className="esl-empty">No activity logs in this session window.</p>
            ) : (
              <ul className="esl-log">
                {selected.logs.map(entry => (
                  <li key={entry.id} className={`esl-log__item esl-log__item--${entry.level}`}>
                    <time>{formatSessionTime(entry.createdAt)}</time>
                    <span>{entry.level}</span>
                    <p>{displayEmaapText(entry.message)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="fade-in page-content esl-page">
      <ListViewBackBar onBack={() => navigate('/admin')} label="Back to dashboard" />

      <header className="esl-head">
        <div className="esl-head__copy">
          <p className="esl-kicker">
            <ShieldCheck size={16} aria-hidden />
            eMaap
          </p>
          <h1 className="esl-title">Session Logs</h1>
        </div>
        <div className="esl-head__tools">
          <div className="esl-totals" aria-label="Total session duration">
            <article className="esl-stat esl-stat--ok">
              <small>Success · 24h</small>
              <strong>{formatTotalDuration(durationTotals.success)}</strong>
              <em>{successPct}%</em>
            </article>
            <article className="esl-stat esl-stat--bad">
              <small>Failed · 24h</small>
              <strong>{formatTotalDuration(durationTotals.failed)}</strong>
            </article>
          </div>
          <button
            type="button"
            className="esl-icon-btn"
            aria-label="Search sessions"
            onClick={() => {
              setSearchOpen(open => !open);
              setFilterOpen(false);
            }}
          >
            <Search size={18} />
          </button>
          <div className="esl-filter" ref={filterRef}>
            <button
              type="button"
              className={`esl-icon-btn${filterOpen ? ' esl-icon-btn--on' : ''}`}
              aria-label="Filters"
              aria-expanded={filterOpen}
              onClick={() => {
                setFilterOpen(open => !open);
                setSearchOpen(false);
              }}
            >
              <ListFilter size={18} />
            </button>
            {filterOpen && (
              <div className="esl-filter__pop" role="dialog" aria-label="Session filters">
                <button type="button" className="esl-export" onClick={() => exportEmaapSessionsCsv(filtered)}>
                  <Download size={15} aria-hidden />
                  Export
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="esl-pills" role="tablist" aria-label="Period">
          {PERIODS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`esl-pill${period === item.id ? ' esl-pill--active' : ''}`}
              onClick={() => selectPeriod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {period === 'custom' ? (
          <div className="esl-filter__custom esl-head__custom">
            <input type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} />
            <span aria-hidden>–</span>
            <input type="date" value={customTo} onChange={event => setCustomTo(event.target.value)} />
          </div>
        ) : null}
        <div className="esl-pills" role="tablist" aria-label="Session status">
          {STATUS_FILTERS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`esl-pill${filter === item.id ? ' esl-pill--active' : ''}${
                item.id === 'success' ? ' esl-pill--ok' : item.id === 'failed' ? ' esl-pill--bad' : ''
              }`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {item.id === 'all' ? ` ${counts.all}` : ` ${counts[item.id]}`}
            </button>
          ))}
        </div>
      </header>

      {searchOpen && (
        <input
          className="esl-search input-field"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search session, machine, error…"
          autoFocus
        />
      )}

      {loading ? (
        <p className="esl-empty">Loading sessions…</p>
      ) : paged.length === 0 ? (
        <p className="esl-empty">No eMaap sessions in this range.</p>
      ) : (
        <ul className="esl-list">
          {paged.map(row => (
            <li key={row.id}>
              <SessionCard row={row} />
            </li>
          ))}
        </ul>
      )}

      <TablePagination
        page={page}
        totalItems={filtered.length}
        pageSize={EMAAP_SESSION_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
};
