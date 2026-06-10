import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock,
  ImageIcon,
  Layers,
  ListOrdered,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  averageSessionSeconds,
  formatDuration,
  resolveWorkerRuntimeState,
  saveAutomationWorkerRemoteControl,
  subscribeAutomationWorkerCaptchaAttempts,
  subscribeAutomationWorkerLogs,
  subscribeAutomationWorkerRemote,
  subscribeAutomationWorkerSessions,
  subscribeAutomationWorkerStatus,
  type AutomationWorkerCaptchaAttempt,
  type AutomationWorkerLogEntry,
  type AutomationWorkerRemoteControl,
  type AutomationWorkerSessionEvent,
  type AutomationWorkerStatus,
  type WorkerRuntimeState,
  DEFAULT_AUTOMATION_WORKER_REMOTE,
} from '../lib/automationWorker';
import {
  diagnoseVerificationPipeline,
  findVerificationBySerial,
  repairVerificationForPhase2,
  repairVerificationCertified,
  repairVerificationSubmitted,
  type PipelineRepairDiagnosis,
} from '../lib/verificationPipelineRepair';
import type { SiteCalibration } from '../types';

type AutomationWorkerCardProps = {
  className?: string;
};

type WorkerLogTab = 'activity' | 'captcha' | 'sessions';

const RUNTIME_LABELS: Record<WorkerRuntimeState, string> = {
  idle: 'Idle',
  working: 'Processing jobs',
  paused: 'Paused',
  login_required: 'DOCA login required',
  error: 'Error',
  offline: 'Offline',
};

const RUNTIME_HINTS: Record<WorkerRuntimeState, string> = {
  idle: 'Worker is online and waiting for queue jobs.',
  working: 'Actively processing certificate jobs on DOCA.',
  paused: 'Remote pause is active — jobs will not run.',
  login_required: 'DOCA session expired — worker needs a fresh login.',
  error: 'Worker reported an error — check activity logs.',
  offline: 'No heartbeat received — server may be down or unreachable.',
};

function formatTimestamp(value: string): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function formatCompactTimestamp(value: string): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const date = new Date(parsed);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeAge(value: string): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatCaptchaOutcome(outcome: string): string {
  return outcome.replace(/_/g, ' ');
}

function formatSessionProbeResult(result: string): string {
  switch (result) {
    case 'valid':
      return 'Valid';
    case 'expired':
      return 'Session expired';
    case 'error':
      return 'Probe error';
    case 'browser_disconnected':
      return 'Browser disconnected';
    default:
      return result ? result.replace(/_/g, ' ') : '—';
  }
}

function formatLogoutReason(reason: string): string {
  switch (reason) {
    case 'session_probe':
      return 'Periodic probe';
    case 'job_failure':
      return 'Job detected logout';
    case 'login_required':
      return 'Login failed';
    default:
      return reason ? reason.replace(/_/g, ' ') : 'Unknown';
  }
}

function captchaRateTone(rate: number | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (rate == null) return 'neutral';
  if (rate >= 70) return 'good';
  if (rate >= 45) return 'warn';
  return 'bad';
}

function logLevelIcon(level: string): React.ReactNode {
  switch (level) {
    case 'error':
      return <XCircle size={14} aria-hidden />;
    case 'success':
      return <CheckCircle2 size={14} aria-hidden />;
    default:
      return <Activity size={14} aria-hidden />;
  }
}

export const AutomationWorkerCard: React.FC<AutomationWorkerCardProps> = ({ className = '' }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<AutomationWorkerStatus | null>(null);
  const [remote, setRemote] = useState<AutomationWorkerRemoteControl>(DEFAULT_AUTOMATION_WORKER_REMOTE);
  const [logs, setLogs] = useState<AutomationWorkerLogEntry[]>([]);
  const [captchaAttempts, setCaptchaAttempts] = useState<AutomationWorkerCaptchaAttempt[]>([]);
  const [sessions, setSessions] = useState<AutomationWorkerSessionEvent[]>([]);
  const [activeLogTab, setActiveLogTab] = useState<WorkerLogTab>('activity');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [listenerError, setListenerError] = useState('');
  const [repairSerial, setRepairSerial] = useState('');
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairRecords, setRepairRecords] = useState<SiteCalibration[]>([]);
  const [repairDiagnoses, setRepairDiagnoses] = useState<PipelineRepairDiagnosis[]>([]);
  const [repairMessage, setRepairMessage] = useState('');

  const runtimeState = useMemo(() => resolveWorkerRuntimeState(status), [status]);
  const heartbeatAge = useMemo(
    () => formatRelativeAge(status?.lastHeartbeatAt || ''),
    [status?.lastHeartbeatAt],
  );

  const captchaStats = useMemo(() => {
    const withText = captchaAttempts.filter(item => item.resolvedText);
    const failed = captchaAttempts.filter(
      item => !item.success && (item.outcome === 'invalid_captcha' || item.outcome === 'ocr_failed'),
    );
    const success = captchaAttempts.filter(item => item.success);
    return {
      total: captchaAttempts.length,
      failed: failed.length,
      success: success.length,
      successRate:
        withText.length > 0 ? Math.round((success.length / withText.length) * 100) : null,
    };
  }, [captchaAttempts]);

  const avgSessionSeconds = useMemo(() => averageSessionSeconds(sessions), [sessions]);
  const captchaTone = captchaRateTone(captchaStats.successRate);
  const docaLoggedIn = status?.docaSessionState === 'logged_in';

  useEffect(() => {
    const onListenerError = (err: Error) => {
      setListenerError(err.message);
    };

    const unsubscribers = [
      subscribeAutomationWorkerStatus(setStatus, onListenerError),
      subscribeAutomationWorkerRemote(setRemote, onListenerError),
      subscribeAutomationWorkerLogs(setLogs, onListenerError),
      subscribeAutomationWorkerCaptchaAttempts(setCaptchaAttempts, onListenerError),
      subscribeAutomationWorkerSessions(setSessions, onListenerError),
    ];
    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const pushRemote = async (
    patch: Partial<AutomationWorkerRemoteControl>,
    options?: { incrementCommand?: boolean },
  ) => {
    if (!user?.uid) return;
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await saveAutomationWorkerRemoteControl(remote, patch, user.uid, options);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update worker controls.');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePause = async () => {
    if (!remote) return;
    await pushRemote({ pauseWorker: !remote.pauseWorker }, { incrementCommand: true });
  };

  const handleToggleAutoWorker = async () => {
    if (!remote) return;
    await pushRemote(
      { autoWorkerEnabled: !remote.autoWorkerEnabled },
      { incrementCommand: true },
    );
  };

  const handleToggleFillOnly = async () => {
    if (!remote) return;
    await pushRemote({ docaFillOnly: !remote.docaFillOnly }, { incrementCommand: true });
  };

  const remoteReady = user?.role === 'super_admin';

  const handleLookupSerial = async (keepRepairMessage = false) => {
    setError('');
    if (!keepRepairMessage) {
      setRepairMessage('');
    }
    setRepairLoading(true);
    try {
      const records = await findVerificationBySerial(repairSerial);
      setRepairRecords(records);
      setRepairDiagnoses(records.map(diagnoseVerificationPipeline));
      if (records.length === 0) {
        setRepairMessage('No verification found for that serial number.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Serial lookup failed.');
    } finally {
      setRepairLoading(false);
    }
  };

  const handleRepairCertified = async (recordId: string) => {
    setError('');
    setRepairMessage('');
    setRepairLoading(true);
    try {
      await repairVerificationCertified(recordId, repairRecords.find(r => r.id === recordId));
      setRepairMessage('Record repaired — certified status and timestamps fixed in Firestore.');
      await handleLookupSerial(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Repair failed.');
    } finally {
      setRepairLoading(false);
    }
  };

  const handleRepairForPhase2 = async (recordId: string) => {
    setError('');
    setRepairMessage('');
    setRepairLoading(true);
    try {
      await repairVerificationForPhase2(recordId, repairRecords.find(r => r.id === recordId));
      setRepairMessage('Record repaired — status set to approved. The worker should pick it up for Phase 2 within ~30 seconds.');
      await handleLookupSerial(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Repair failed.');
    } finally {
      setRepairLoading(false);
    }
  };

  const handleRepairSubmitted = async (recordId: string) => {
    setError('');
    setRepairMessage('');
    setRepairLoading(true);
    try {
      await repairVerificationSubmitted(
        recordId,
        repairRecords.find(r => r.id === recordId)?.submittedAt,
        repairRecords.find(r => r.id === recordId),
      );
      setRepairMessage('Record repaired — status restored to submitted. The worker should pick it up within ~30 seconds.');
      await handleLookupSerial(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Repair failed.');
    } finally {
      setRepairLoading(false);
    }
  };

  return (
    <div className={`automation-worker${className ? ` ${className}` : ''}`}>
      {(error || listenerError || saved || repairMessage) && (
        <div className="cw-alerts" role="status" aria-live="polite">
          {error && (
            <div className="cw-alert cw-alert--error">
              <XCircle size={16} aria-hidden />
              <span>{error}</span>
            </div>
          )}
          {listenerError && (
            <div className="cw-alert cw-alert--error">
              <XCircle size={16} aria-hidden />
              <span>
                Live updates error: {listenerError}. If this mentions an index, open the Firebase console link from the browser devtools network tab.
              </span>
            </div>
          )}
          {saved && (
            <div className="cw-alert cw-alert--success">
              <CheckCircle2 size={16} aria-hidden />
              <span>Worker settings sent. The desktop app applies them on its next sync.</span>
            </div>
          )}
          {repairMessage && (
            <div className="cw-alert cw-alert--success">
              <CheckCircle2 size={16} aria-hidden />
              <span>{repairMessage}</span>
            </div>
          )}
        </div>
      )}

      <section className={`cw-hero cw-hero--${runtimeState}`} aria-label="Worker status">
        <div className="cw-hero-main">
          <div className="cw-hero-status">
            <span className={`cw-status-dot cw-status-dot--${runtimeState}`} aria-hidden />
            <div>
              <p className="cw-hero-label">Worker status</p>
              <h2 className="cw-hero-title">{RUNTIME_LABELS[runtimeState]}</h2>
              <p className="cw-hero-message">
                {status?.statusMessage || RUNTIME_HINTS[runtimeState]}
              </p>
            </div>
          </div>

          <div className="cw-hero-chips">
            <span className="cw-chip">
              <span className="cw-chip-label">Machine</span>
              <strong>{status?.machineName || '—'}</strong>
            </span>
            <span className={`cw-chip cw-chip--${docaLoggedIn ? 'ok' : 'warn'}`}>
              <ShieldCheck size={14} aria-hidden />
              <span className="cw-chip-label">DOCA</span>
              <strong>{docaLoggedIn ? 'Logged in' : 'Login required'}</strong>
            </span>
            <span className="cw-chip">
              <Clock size={14} aria-hidden />
              <span className="cw-chip-label">Heartbeat</span>
              <strong>{heartbeatAge || formatTimestamp(status?.lastHeartbeatAt || '')}</strong>
            </span>
          </div>
        </div>

        <div className="cw-controls" aria-label="Worker controls">
          <button
            type="button"
            className={`cw-control-btn${remote?.pauseWorker ? ' cw-control-btn--primary' : ''}`}
            disabled={!remoteReady || saving}
            onClick={() => void handleTogglePause()}
          >
            {remote?.pauseWorker ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
            {remote?.pauseWorker ? 'Resume worker' : 'Pause worker'}
          </button>
          <button
            type="button"
            className={`cw-control-btn${remote?.autoWorkerEnabled === false ? ' cw-control-btn--primary' : ''}`}
            disabled={!remoteReady || saving}
            onClick={() => void handleToggleAutoWorker()}
          >
            <RefreshCw size={16} aria-hidden />
            {remote?.autoWorkerEnabled === false ? 'Enable auto worker' : 'Disable auto worker'}
          </button>
          <label className="cw-switch">
            <input
              type="checkbox"
              checked={remote?.docaFillOnly ?? false}
              disabled={!remoteReady || saving}
              onChange={() => void handleToggleFillOnly()}
            />
            <span className="cw-switch-track" aria-hidden />
            <span className="cw-switch-copy">
              <strong>Fill only</strong>
              <span>Fill DOCA forms without submitting</span>
            </span>
          </label>
        </div>
      </section>

      <section className="cw-metrics" aria-label="Worker metrics">
        <article className="cw-metric cw-metric--highlight">
          <ListOrdered size={18} aria-hidden />
          <div>
            <p className="cw-metric-label">Eligible now</p>
            <p className="cw-metric-value">{status?.queueEligible ?? '—'}</p>
            <p className="cw-metric-sub">{status?.queueTotal ?? '—'} pending total</p>
          </div>
        </article>
        <article className="cw-metric">
          <Layers size={18} aria-hidden />
          <div>
            <p className="cw-metric-label">Queue breakdown</p>
            <p className="cw-metric-value cw-metric-value--inline">
              <span>{status?.queueSubmitted ?? '—'} submitted</span>
              <span className="cw-metric-sep">·</span>
              <span>{status?.queueApproved ?? '—'} approved</span>
            </p>
            <p className="cw-metric-sub">Firestore pipeline stages</p>
          </div>
        </article>
        <article className="cw-metric">
          <CheckCircle2 size={18} aria-hidden />
          <div>
            <p className="cw-metric-label">Session jobs</p>
            <p className="cw-metric-value cw-metric-value--inline">
              <span className="cw-metric-good">{status?.jobsCompletedSession ?? '—'} done</span>
              <span className="cw-metric-sep">·</span>
              <span className={Number(status?.jobsFailedSession) > 0 ? 'cw-metric-bad' : ''}>
                {status?.jobsFailedSession ?? '—'} failed
              </span>
            </p>
            <p className="cw-metric-sub">Since worker started</p>
          </div>
        </article>
        <article className="cw-metric">
          <Clock size={18} aria-hidden />
          <div>
            <p className="cw-metric-label">DOCA session</p>
            <p className="cw-metric-value">
              {status?.docaSessionAgeSeconds ? formatDuration(status.docaSessionAgeSeconds) : '—'}
            </p>
            <p className="cw-metric-sub">
              Probe: {formatSessionProbeResult(status?.lastSessionProbeResult || '')}
            </p>
          </div>
        </article>
        <article className={`cw-metric cw-metric--${captchaTone}`}>
          <ImageIcon size={18} aria-hidden />
          <div>
            <p className="cw-metric-label">Captcha OCR</p>
            <p className="cw-metric-value">
              {captchaStats.successRate != null ? `${captchaStats.successRate}%` : '—'}
            </p>
            <p className="cw-metric-sub">
              {captchaStats.success}/{captchaStats.total} attempts succeeded
            </p>
          </div>
        </article>
        <article className="cw-metric">
          <Activity size={18} aria-hidden />
          <div>
            <p className="cw-metric-label">Session history</p>
            <p className="cw-metric-value">
              {avgSessionSeconds != null ? formatDuration(avgSessionSeconds) : '—'}
            </p>
            <p className="cw-metric-sub">{sessions.length} logout events logged</p>
          </div>
        </article>
      </section>

      <section className="cw-logs" aria-label="Worker telemetry">
        <div className="cw-log-tabs" role="tablist" aria-label="Worker logs">
          {([
            ['activity', 'Activity', logs.length] as const,
            ['captcha', 'Captcha OCR', captchaAttempts.length] as const,
            ['sessions', 'DOCA sessions', sessions.length] as const,
          ]).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeLogTab === id}
              className={activeLogTab === id ? 'cw-log-tab cw-log-tab--active' : 'cw-log-tab'}
              onClick={() => setActiveLogTab(id)}
            >
              {label}
              <span className="cw-log-tab-count">{count}</span>
            </button>
          ))}
        </div>

        {activeLogTab === 'activity' && (
          <div role="tabpanel" className="cw-log-panel cw-log-panel--terminal">
            {logs.length === 0 ? (
              <p className="cw-log-empty">No activity logs yet. Logs appear when the worker reports status changes.</p>
            ) : (
              <ul className="cw-log-list">
                {logs.map(entry => (
                  <li key={entry.id} className={`cw-log-item cw-log-item--${entry.level}`}>
                    <span className="cw-log-level">{logLevelIcon(entry.level)}</span>
                    <time dateTime={entry.createdAt}>{formatCompactTimestamp(entry.createdAt)}</time>
                    <span className="cw-log-message">{entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeLogTab === 'captcha' && (
          <div role="tabpanel" className="cw-log-panel cw-log-panel--captcha">
            {captchaAttempts.length === 0 ? (
              <p className="cw-log-empty">No captcha OCR attempts recorded yet.</p>
            ) : (
              <div className="automation-worker-captcha-scroll">
                <table className="automation-worker-captcha-table">
                  <thead>
                    <tr>
                      <th scope="col">Captcha</th>
                      <th scope="col">Time</th>
                      <th scope="col">Resolved</th>
                      <th scope="col">Status</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Provider</th>
                      <th scope="col">Try</th>
                    </tr>
                  </thead>
                  <tbody>
                    {captchaAttempts.map(attempt => (
                      <tr
                        key={attempt.id}
                        className={attempt.success ? '' : 'automation-worker-captcha-row--failed'}
                        title={formatTimestamp(attempt.createdAt)}
                      >
                        <td className="automation-worker-captcha-cell-image">
                          {attempt.imageUrl ? (
                            <a
                              href={attempt.imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="automation-worker-captcha-thumb-link"
                            >
                              <img
                                src={attempt.imageUrl}
                                alt={`Captcha resolved as ${attempt.resolvedText || 'unknown'}`}
                                loading="lazy"
                              />
                            </a>
                          ) : (
                            <span className="automation-worker-captcha-thumb-placeholder" aria-hidden>
                              <ImageIcon />
                            </span>
                          )}
                        </td>
                        <td className="automation-worker-captcha-cell-time text-mono">
                          {formatCompactTimestamp(attempt.createdAt)}
                        </td>
                        <td className="automation-worker-captcha-cell-text text-mono">
                          {attempt.resolvedText || '(empty)'}
                        </td>
                        <td>
                          <span
                            className={`automation-worker-captcha-status automation-worker-captcha-status--${attempt.success ? 'ok' : 'fail'}`}
                          >
                            {attempt.success ? 'OK' : 'Fail'}
                          </span>
                        </td>
                        <td className="automation-worker-captcha-cell-outcome">
                          {formatCaptchaOutcome(attempt.outcome)}
                        </td>
                        <td className="automation-worker-captcha-cell-provider">
                          {attempt.ocrProvider || '—'}
                        </td>
                        <td className="automation-worker-captcha-cell-try text-mono">
                          {attempt.attemptNumber || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeLogTab === 'sessions' && (
          <div role="tabpanel" className="cw-log-panel">
            {sessions.length === 0 ? (
              <p className="cw-log-empty">No DOCA session logout events yet. Sessions are recorded when the worker detects a logout.</p>
            ) : (
              <ul className="cw-session-list">
                {sessions.map(session => (
                  <li key={session.id} className="cw-session-item">
                    <div className="cw-session-duration">
                      <strong>{formatDuration(session.durationSeconds)}</strong>
                      <span>logged in → logged out</span>
                    </div>
                    <div className="cw-session-meta">
                      {formatTimestamp(session.loggedInAt)} → {formatTimestamp(session.loggedOutAt)}
                      {session.logoutReason ? ` · ${formatLogoutReason(session.logoutReason)}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <details className="cw-recovery">
        <summary className="cw-recovery-summary">
          <Wrench size={16} aria-hidden />
          <span>
            <strong>Pipeline recovery</strong>
            <span className="cw-recovery-hint">Fix serials when DOCA and Firestore are out of sync</span>
          </span>
          <ChevronDown size={16} className="cw-recovery-chevron" aria-hidden />
        </summary>
        <div className="cw-recovery-body">
          <div className="cw-recovery-search">
            <input
              id="worker-repair-serial"
              className="input-field text-mono"
              placeholder="Serial e.g. YXL61309"
              value={repairSerial}
              onChange={e => setRepairSerial(e.target.value)}
              disabled={repairLoading}
              onKeyDown={e => {
                if (e.key === 'Enter' && repairSerial.trim() && remoteReady && !repairLoading) {
                  void handleLookupSerial();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!remoteReady || repairLoading || !repairSerial.trim()}
              onClick={() => void handleLookupSerial()}
            >
              <Search size={16} aria-hidden />
              {repairLoading ? 'Looking up…' : 'Look up'}
            </button>
          </div>

          {repairDiagnoses.length > 0 && (
            <ul className="cw-recovery-list">
              {repairDiagnoses.map((diagnosis, index) => (
                <li key={diagnosis.recordId} className="cw-recovery-item">
                  <div className="cw-recovery-item-head">
                    <strong>{diagnosis.serialNumber}</strong>
                    <span>{repairRecords[index]?.applicationNumber || '—'}</span>
                  </div>
                  <dl className="cw-recovery-kv">
                    <div><dt>Firebase status</dt><dd>{diagnosis.status}</dd></div>
                    <div><dt>Expected DOCA phase</dt><dd>{diagnosis.docaExpectedPhase.replace('_', ' ')}</dd></div>
                    <div><dt>Worker queue</dt><dd>{diagnosis.queueEligible ? 'Eligible' : 'Not listed'}</dd></div>
                    <div><dt>Document ID</dt><dd className="text-mono">{diagnosis.recordId}</dd></div>
                  </dl>
                  {diagnosis.notes.length > 0 && (
                    <ul className="cw-recovery-notes">
                      {diagnosis.notes.map(note => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                  <div className="cw-recovery-actions">
                    {diagnosis.repairAction === 'fix_certified' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={repairLoading}
                        onClick={() => void handleRepairCertified(diagnosis.recordId)}
                      >
                        Fix certified fields
                      </button>
                    )}
                    {diagnosis.repairAction === 'set_approved' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={repairLoading}
                        onClick={() => void handleRepairForPhase2(diagnosis.recordId)}
                      >
                        Mark approved → sync / Phase 2
                      </button>
                    )}
                    {diagnosis.repairAction === 'set_submitted' && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={repairLoading}
                        onClick={() => void handleRepairSubmitted(diagnosis.recordId)}
                      >
                        Restore submitted → re-queue worker
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <footer className="cw-meta-footer">
        <span>Started {formatTimestamp(status?.startedAt || '')}</span>
        <span>Last probe {formatTimestamp(status?.lastSessionProbeAt || '')}</span>
      </footer>
    </div>
  );
};
