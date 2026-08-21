import { formatDuration } from './automationWorker';
import type {
  AutomationWorkerCaptchaAttempt,
  AutomationWorkerLogEntry,
  AutomationWorkerSessionEvent,
  AutomationWorkerStatus,
} from './automationWorker';

export const EMAAP_SESSION_PAGE_SIZE = 10;
export const EMAAP_SESSIONS_PATH = '/admin/integrations/worker/sessions';

export type EmaapSessionStatus = 'active' | 'success' | 'failed';
export type EmaapSessionFilter = 'all' | EmaapSessionStatus;
export type EmaapPeriodFilter = 'today' | 'month' | 'year' | 'custom';
export type EmaapSessionTab = 'overview' | 'timeline' | 'jobs' | 'logs';

export type EmaapSessionJob = {
  label: string;
  certificateNumber: string;
  ok: boolean;
};

export type EmaapSessionRecord = {
  id: string;
  displayId: string;
  status: EmaapSessionStatus;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  downtimeSeconds: number | null;
  nextStartedAt: string;
  machineName: string;
  workerName: string;
  logoutReason: string;
  emaapLoggedIn: boolean;
  jobs: number;
  certified: number;
  failed: number;
  ocr: number;
  otp: number;
  retries: number;
  errorTitle: string;
  errorMessage: string;
  failedAt: string;
  failedJobLabel: string;
  heartbeatAt: string;
  logs: AutomationWorkerLogEntry[];
  captcha: AutomationWorkerCaptchaAttempt[];
  jobRows: EmaapSessionJob[];
};

const FAILED_REASONS = new Set([
  'job_failure',
  'login_required',
  'browser_disconnected',
  'otp_required',
  'error',
]);

const CERT_RE = /IND\/[A-Z0-9/]+/i;

/** User-facing copy: portal is eMaap, not the old DOCA name. */
export function displayEmaapText(value: string): string {
  return value.replace(/\bDOCA\b/gi, 'eMaap');
}

export function formatLogoutReason(reason: string): string {
  switch (reason) {
    case 'session_probe':
      return 'Periodic probe';
    case 'session_gap':
      return 'Logged out until next login';
    case 'job_failure':
      return 'Job detected logout';
    case 'login_required':
      return 'Login failed';
    case 'otp_required':
      return 'OTP required';
    case 'browser_disconnected':
      return 'Browser disconnected';
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Unknown';
  }
}

export function formatSessionDateTime(iso: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatSessionTime(iso: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatSessionStamp(iso: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatSessionDay(iso: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatHeartbeatAge(iso: string): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return formatDuration(seconds);
}

function parseMs(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

function inWindow(iso: string, start: number, end: number): boolean {
  const ms = parseMs(iso);
  return ms != null && ms >= start && ms <= end;
}

function sessionStatus(reason: string): EmaapSessionStatus {
  return FAILED_REASONS.has(reason) ? 'failed' : 'success';
}

function tallyLogs(logs: AutomationWorkerLogEntry[]): {
  certified: number;
  failed: number;
  otp: number;
  retries: number;
  errorLog: AutomationWorkerLogEntry | null;
  jobRows: EmaapSessionJob[];
} {
  let certified = 0;
  let failed = 0;
  let otp = 0;
  let retries = 0;
  let errorLog: AutomationWorkerLogEntry | null = null;
  const jobRows: EmaapSessionJob[] = [];

  for (const entry of logs) {
    const text = entry.message;
    const lower = text.toLowerCase();
    const cert = text.match(CERT_RE)?.[0]?.toUpperCase() ?? '';
    if (lower.includes('otp')) otp += 1;
    if (lower.includes('retry')) retries += 1;
    if (entry.level === 'error' || /timeout|failed|login required/.test(lower)) {
      failed += 1;
      errorLog = entry;
      if (cert) jobRows.push({ label: `Job · ${cert}`, certificateNumber: cert, ok: false });
      continue;
    }
    if (/certified|certificate issued|job completed|completed job/.test(lower)) {
      certified += 1;
      if (cert) jobRows.push({ label: `Job · ${cert}`, certificateNumber: cert, ok: true });
    }
  }

  return { certified, failed, otp, retries, errorLog, jobRows };
}

function assignDisplayIds(records: EmaapSessionRecord[]): EmaapSessionRecord[] {
  const chronological = [...records]
    .filter(record => record.id !== 'active' && record.status !== 'active')
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  const perDay = new Map<string, number>();
  const ids = new Map<string, string>();
  for (const record of chronological) {
    const started = parseMs(record.startedAt);
    const day = started
      ? `${String(new Date(started).getFullYear()).slice(-2)}${String(new Date(started).getMonth() + 1).padStart(2, '0')}${String(new Date(started).getDate()).padStart(2, '0')}`
      : '000000';
    const next = (perDay.get(day) || 0) + 1;
    perDay.set(day, next);
    ids.set(record.id, `SES-${day}-${String(next).padStart(4, '0')}`);
  }
  return records.map(record =>
    record.id === 'active' || record.status === 'active'
      ? record
      : { ...record, displayId: ids.get(record.id) || record.displayId },
  );
}

function enrichClosedSession(
  event: AutomationWorkerSessionEvent,
  logs: AutomationWorkerLogEntry[],
  captcha: AutomationWorkerCaptchaAttempt[],
): EmaapSessionRecord {
  const start = parseMs(event.loggedInAt) ?? 0;
  const end = parseMs(event.loggedOutAt) ?? start;
  const windowLogs = logs
    .filter(entry => inWindow(entry.createdAt, start, end))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const windowCaptcha = captcha.filter(item => inWindow(item.createdAt, start, end));
  const tally = tallyLogs(windowLogs);
  const storedCertified = event.jobsCompleted;
  const storedFailed = event.jobsFailed;
  const certified = storedCertified ?? tally.certified;
  const failed = storedFailed ?? tally.failed;
  const status = sessionStatus(event.logoutReason);
  const errorLog = tally.errorLog;

  return {
    id: event.id,
    displayId: event.id.slice(0, 12),
    status,
    startedAt: event.loggedInAt,
    endedAt: event.loggedOutAt,
    durationSeconds: event.durationSeconds,
    downtimeSeconds: null,
    nextStartedAt: '',
    machineName: event.machineName || 'VPS',
    workerName: event.workerName || 'Certificate Worker',
    logoutReason: event.logoutReason,
    emaapLoggedIn: status !== 'failed',
    jobs: Math.max(certified + failed, certified, failed),
    certified,
    failed,
    ocr: windowCaptcha.length,
    otp: tally.otp,
    retries: tally.retries,
    errorTitle: status === 'failed' ? 'Error' : '',
    errorMessage:
      status === 'failed'
        ? displayEmaapText(errorLog?.message || formatLogoutReason(event.logoutReason))
        : '',
    failedAt: status === 'failed' ? errorLog?.createdAt || event.loggedOutAt : '',
    failedJobLabel: tally.jobRows.find(row => !row.ok)?.label || '',
    heartbeatAt: '',
    logs: windowLogs,
    captcha: windowCaptcha,
    jobRows: tally.jobRows,
  };
}

function activeSession(
  status: AutomationWorkerStatus | null,
  logs: AutomationWorkerLogEntry[],
  captcha: AutomationWorkerCaptchaAttempt[],
): EmaapSessionRecord | null {
  if (!status || status.docaSessionState !== 'logged_in' || !status.docaLoggedInAt) return null;
  const start = parseMs(status.docaLoggedInAt) ?? Date.now();
  const end = Date.now();
  const windowLogs = logs
    .filter(entry => inWindow(entry.createdAt, start, end))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const windowCaptcha = captcha.filter(item => inWindow(item.createdAt, start, end));
  const tally = tallyLogs(windowLogs);
  const certified = status.jobsCompletedSession || tally.certified;
  const failed = status.jobsFailedSession || tally.failed;

  return {
    id: 'active',
    displayId: 'SES-ACTIVE',
    status: 'active',
    startedAt: status.docaLoggedInAt,
    endedAt: '',
    durationSeconds: status.docaSessionAgeSeconds,
    downtimeSeconds: null,
    nextStartedAt: '',
    machineName: status.machineName || 'VPS',
    workerName: 'Certificate Worker',
    logoutReason: '',
    emaapLoggedIn: true,
    jobs: Math.max(certified + failed, certified, failed),
    certified,
    failed,
    ocr: windowCaptcha.length,
    otp: tally.otp,
    retries: tally.retries,
    errorTitle: '',
    errorMessage: '',
    failedAt: '',
    failedJobLabel: '',
    heartbeatAt: status.lastHeartbeatAt,
    logs: windowLogs,
    captcha: windowCaptcha,
    jobRows: tally.jobRows,
  };
}

function attachDowntime(records: EmaapSessionRecord[]): EmaapSessionRecord[] {
  const chrono = [...records].sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  const downtime = new Map<string, { seconds: number; nextStartedAt: string }>();
  for (let i = 0; i < chrono.length; i += 1) {
    const current = chrono[i];
    const next = chrono[i + 1];
    if (!current || !next) continue;
    const ended = parseMs(current.endedAt);
    const nextStart = parseMs(next.startedAt);
    if (ended == null || nextStart == null) continue;
    downtime.set(current.id, {
      seconds: Math.max(0, Math.round((nextStart - ended) / 1000)),
      nextStartedAt: next.startedAt,
    });
  }
  return records.map(row => {
    const gap = downtime.get(row.id);
    return {
      ...row,
      downtimeSeconds: gap?.seconds ?? null,
      nextStartedAt: gap?.nextStartedAt ?? '',
    };
  });
}

function makeGapFailureRecord(
  prev: EmaapSessionRecord,
  next: EmaapSessionRecord,
  seconds: number,
): EmaapSessionRecord {
  const logoutAt = prev.endedAt;
  return {
    id: `gap--${prev.id}--${next.id}`,
    displayId: 'SES-GAP',
    status: 'failed',
    startedAt: logoutAt,
    endedAt: logoutAt,
    durationSeconds: seconds,
    downtimeSeconds: seconds,
    nextStartedAt: next.startedAt,
    machineName: prev.machineName || next.machineName || 'VPS',
    workerName: prev.workerName || next.workerName || 'Certificate Worker',
    logoutReason: 'session_gap',
    emaapLoggedIn: false,
    jobs: 0,
    certified: 0,
    failed: 0,
    ocr: 0,
    otp: 0,
    retries: 0,
    errorTitle: 'Error',
    errorMessage: 'eMaap logged out until the next login.',
    failedAt: logoutAt,
    failedJobLabel: '',
    heartbeatAt: '',
    logs: [],
    captcha: [],
    jobRows: [],
  };
}

function insertGapFailureRecords(records: EmaapSessionRecord[]): EmaapSessionRecord[] {
  const chrono = [...records]
    .filter(row => !row.id.startsWith('gap--'))
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
  const gaps: EmaapSessionRecord[] = [];
  for (let i = 0; i < chrono.length; i += 1) {
    const current = chrono[i];
    const next = chrono[i + 1];
    if (!current || !next || current.status === 'failed') continue;
    const seconds = current.downtimeSeconds;
    if (seconds == null || seconds < 1) continue;
    gaps.push(makeGapFailureRecord(current, next, seconds));
  }
  const numberedGaps = assignDisplayIds(gaps).map(row => ({
    ...row,
    displayId: row.displayId.replace(/^SES-(\d+)-/, 'SES-$1-F'),
  }));
  return [...records, ...numberedGaps];
}

export function buildEmaapSessionHistory(
  events: AutomationWorkerSessionEvent[],
  logs: AutomationWorkerLogEntry[],
  captcha: AutomationWorkerCaptchaAttempt[],
  status: AutomationWorkerStatus | null,
): EmaapSessionRecord[] {
  const closed = events.map(event => enrichClosedSession(event, logs, captcha));
  const live = activeSession(status, logs, captcha);
  const merged = live ? [live, ...closed] : closed;
  return insertGapFailureRecords(attachDowntime(assignDisplayIds(merged))).sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return (b.startedAt || '').localeCompare(a.startedAt || '');
  });
}

export function tallyEmaapSessionFilters(records: EmaapSessionRecord[]): Record<EmaapSessionFilter, number> {
  return {
    all: records.length,
    active: records.filter(row => row.status === 'active').length,
    success: records.filter(row => row.status === 'success').length,
    failed: records.filter(row => row.status === 'failed').length,
  };
}

function overlapSeconds(startIso: string, endIso: string, windowStart: number, windowEnd: number): number {
  const start = parseMs(startIso);
  if (start == null) return 0;
  const rawEnd = parseMs(endIso);
  const end = rawEnd ?? windowEnd;
  const from = Math.max(start, windowStart);
  const to = Math.min(end, windowEnd);
  return Math.max(0, Math.round((to - from) / 1000));
}

/** Success + failed duration clipped to the rolling last 24 hours. */
export function tallyEmaapDurationLast24h(records: EmaapSessionRecord[]): { success: number; failed: number } {
  const windowEnd = Date.now();
  const windowStart = windowEnd - 24 * 60 * 60 * 1000;
  let success = 0;
  let failed = 0;
  for (const row of records) {
    if (row.status === 'failed') {
      failed += overlapSeconds(row.endedAt || row.startedAt, row.nextStartedAt, windowStart, windowEnd);
      continue;
    }
    success += overlapSeconds(row.startedAt, row.endedAt, windowStart, windowEnd);
  }
  return { success, failed };
}

export function emaapPeriodRange(
  period: EmaapPeriodFilter,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  const now = new Date();
  const iso = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  if (period === 'today') {
    const day = iso(now);
    return { from: day, to: day };
  }
  if (period === 'month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
  if (period === 'year') {
    return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  }
  return { from: customFrom, to: customTo };
}

export function filterEmaapSessions(
  records: EmaapSessionRecord[],
  filter: EmaapSessionFilter,
  search: string,
  from: string,
  to: string,
): EmaapSessionRecord[] {
  const q = search.trim().toLowerCase();
  const fromMs = from ? Date.parse(`${from}T00:00:00`) : null;
  const toMs = to ? Date.parse(`${to}T23:59:59.999`) : null;
  return records.filter(row => {
    if (filter !== 'all' && row.status !== filter) return false;
    const start = parseMs(row.startedAt);
    const end =
      row.status === 'active'
        ? Date.now()
        : row.status === 'failed'
          ? parseMs(row.nextStartedAt) ?? parseMs(row.endedAt) ?? start
          : parseMs(row.endedAt) ?? start;
    if (fromMs != null && end != null && end < fromMs) return false;
    if (toMs != null && start != null && start > toMs) return false;
    if (!q) return true;
    return [
      row.displayId,
      row.machineName,
      row.workerName,
      row.logoutReason,
      row.errorMessage,
      ...row.logs.map(entry => entry.message),
    ]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

export function exportEmaapSessionsCsv(records: EmaapSessionRecord[]): void {
  const header = [
    'Session',
    'Status',
    'Started',
    'Ended',
    'DurationSeconds',
    'NextLogin',
    'DowntimeSeconds',
    'Machine',
    'Jobs',
    'Certified',
    'Failed',
    'OCR',
    'OTP',
    'LogoutReason',
  ];
  const lines = [
    header.join(','),
    ...records.map(row =>
      [
        row.displayId,
        row.status,
        row.startedAt,
        row.endedAt,
        String(row.durationSeconds),
        row.nextStartedAt,
        row.downtimeSeconds == null ? '' : String(row.downtimeSeconds),
        row.machineName,
        String(row.jobs),
        String(row.certified),
        String(row.failed),
        String(row.ocr),
        String(row.otp),
        formatLogoutReason(row.logoutReason),
      ]
        .map(value => `"${value.replace(/"/g, '""')}"`)
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `emaap-session-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
