import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Clock,
  ImageIcon,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Wrench,
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
  paused: 'Paused (remote)',
  login_required: 'DOCA login required',
  error: 'Error',
  offline: 'Offline',
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

function formatCaptchaOutcome(outcome: string): string {
  return outcome.replace(/_/g, ' ');
}

function runtimeClass(state: WorkerRuntimeState): string {
  return `automation-worker-status-dot automation-worker-status-dot--${state}`;
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

  const handleRepairForPhase2 = async (recordId: string) => {
    setError('');
    setRepairMessage('');
    setRepairLoading(true);
    try {
      await repairVerificationForPhase2(recordId);
      setRepairMessage('Record repaired — status set to approved. The worker should pick it up for Phase 2 within ~30 seconds.');
      await handleLookupSerial(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Repair failed.');
    } finally {
      setRepairLoading(false);
    }
  };

  const handleRepairSubmitted = async (recordId: string, submittedAt?: string) => {
    setError('');
    setRepairMessage('');
    setRepairLoading(true);
    try {
      await repairVerificationSubmitted(recordId, submittedAt);
      setRepairMessage('Record repaired — status restored to submitted. The worker should pick it up within ~30 seconds.');
      await handleLookupSerial(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Repair failed.');
    } finally {
      setRepairLoading(false);
    }
  };

  return (
    <div className={`panel glass mt-6 automation-worker-card${className ? ` ${className}` : ''}`}>
      <div className="panel-header">
        <h2><Bot className="inline-icon" /> Automation Worker</h2>
        <p className="text-muted text-sm mb-0">
          Remote control and telemetry for the DOCA certificate worker on Windows Server.
        </p>
      </div>

      <div className="panel-body">
        {error && <p className="form-error mb-3">{error}</p>}
        {listenerError && (
          <p className="form-error mb-3">
            Live updates error: {listenerError}. If this mentions an index, open the Firebase console link from the browser devtools network tab.
          </p>
        )}
        {saved && <p className="text-success text-sm mb-3">Worker settings sent. The desktop app applies them on its next sync.</p>}
        {repairMessage && <p className="text-success text-sm mb-3">{repairMessage}</p>}

        <section className="automation-worker-recovery mb-6">
          <h3 className="automation-worker-section-title"><Wrench className="inline-icon" /> Pipeline recovery</h3>
          <p className="text-muted text-sm">
            Look up a serial when DOCA and Firebase are out of sync or the worker queue shows 0 jobs.
          </p>
          <div className="automation-worker-control-row mb-3">
            <input
              id="worker-repair-serial"
              className="input-field text-mono"
              placeholder="Serial e.g. YXL61309"
              value={repairSerial}
              onChange={e => setRepairSerial(e.target.value)}
              disabled={repairLoading}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!remoteReady || repairLoading || !repairSerial.trim()}
              onClick={() => void handleLookupSerial()}
            >
              <Search className="inline-icon" />
              {repairLoading ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          {repairDiagnoses.length > 0 && (
            <ul className="automation-worker-recovery-list">
              {repairDiagnoses.map((diagnosis, index) => (
                <li key={diagnosis.recordId} className="automation-worker-recovery-item">
                  <div>
                    <strong>{diagnosis.serialNumber}</strong>
                    <span className="text-muted text-sm"> · {repairRecords[index]?.applicationNumber || '—'}</span>
                  </div>
                  <dl className="automation-worker-kv mt-2">
                    <div><dt>Firebase status</dt><dd>{diagnosis.status}</dd></div>
                    <div><dt>Expected DOCA phase</dt><dd>{diagnosis.docaExpectedPhase.replace('_', ' ')}</dd></div>
                    <div><dt>Worker queue</dt><dd>{diagnosis.queueEligible ? 'Eligible' : 'Not listed'}</dd></div>
                    <div><dt>Document ID</dt><dd className="text-mono text-sm">{diagnosis.recordId}</dd></div>
                  </dl>
                  {diagnosis.notes.length > 0 && (
                    <ul className="text-muted text-sm mb-2">
                      {diagnosis.notes.map(note => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                  {diagnosis.repairAction === 'set_approved' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={repairLoading}
                      onClick={() => void handleRepairForPhase2(diagnosis.recordId)}
                    >
                      Mark approved → re-queue Phase 2
                    </button>
                  )}
                  {diagnosis.repairAction === 'set_submitted' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={repairLoading}
                      onClick={() => void handleRepairSubmitted(
                        diagnosis.recordId,
                        repairRecords[index]?.submittedAt,
                      )}
                    >
                      Restore submitted → re-queue worker
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="automation-worker-status-grid mb-6">
          <div className="automation-worker-status-card">
            <div className="automation-worker-status-head">
              <span className={runtimeClass(runtimeState)} aria-hidden />
              <div>
                <strong>{RUNTIME_LABELS[runtimeState]}</strong>
                <p className="text-muted text-sm mb-0">{status?.statusMessage || 'Waiting for worker heartbeat…'}</p>
              </div>
            </div>
            <dl className="automation-worker-kv">
              <div><dt>Machine</dt><dd>{status?.machineName || '—'}</dd></div>
              <div><dt>Last heartbeat</dt><dd>{formatTimestamp(status?.lastHeartbeatAt || '')}</dd></div>
              <div><dt>DOCA session</dt><dd>{status?.docaSessionState === 'logged_in' ? 'Logged in' : 'Login required'}</dd></div>
              <div><dt>Worker started</dt><dd>{formatTimestamp(status?.startedAt || '')}</dd></div>
            </dl>
          </div>

          <div className="automation-worker-status-card">
            <h3 className="automation-worker-section-title"><Server className="inline-icon" /> Queue</h3>
            <dl className="automation-worker-stat-grid">
              <div><dt>Pending total</dt><dd>{status?.queueTotal ?? '—'}</dd></div>
              <div><dt>Eligible now</dt><dd>{status?.queueEligible ?? '—'}</dd></div>
              <div><dt>Submitted</dt><dd>{status?.queueSubmitted ?? '—'}</dd></div>
              <div><dt>Approved</dt><dd>{status?.queueApproved ?? '—'}</dd></div>
              <div><dt>Done (session)</dt><dd>{status?.jobsCompletedSession ?? '—'}</dd></div>
              <div><dt>Failed (session)</dt><dd>{status?.jobsFailedSession ?? '—'}</dd></div>
            </dl>
          </div>

          <div className="automation-worker-status-card">
            <h3 className="automation-worker-section-title"><Clock className="inline-icon" /> Session insights</h3>
            <dl className="automation-worker-stat-grid">
              <div><dt>Avg DOCA session</dt><dd>{avgSessionSeconds != null ? formatDuration(avgSessionSeconds) : '—'}</dd></div>
              <div><dt>Sessions logged</dt><dd>{sessions.length}</dd></div>
              <div><dt>Captcha attempts</dt><dd>{captchaStats.total}</dd></div>
              <div><dt>Captcha failures</dt><dd>{captchaStats.failed}</dd></div>
              <div><dt>Captcha success rate</dt><dd>{captchaStats.successRate != null ? `${captchaStats.successRate}%` : '—'}</dd></div>
              <div><dt>Fill-only mode</dt><dd>{status?.docaFillOnly ? 'On' : 'Off'}</dd></div>
            </dl>
          </div>
        </section>

        <section className="automation-worker-controls mb-6">
          <h3 className="automation-worker-section-title"><Activity className="inline-icon" /> Controls</h3>
          <div className="automation-worker-control-row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!remoteReady || saving}
              onClick={() => void handleTogglePause()}
            >
              {remote?.pauseWorker ? <Play className="inline-icon" /> : <Pause className="inline-icon" />}
              {remote?.pauseWorker ? 'Resume worker' : 'Pause worker'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!remoteReady || saving}
              onClick={() => void handleToggleAutoWorker()}
            >
              <RefreshCw className="inline-icon" />
              {remote?.autoWorkerEnabled === false ? 'Enable auto worker' : 'Disable auto worker'}
            </button>
            <label className="automation-worker-toggle">
              <input
                type="checkbox"
                checked={remote?.docaFillOnly ?? false}
                disabled={!remoteReady || saving}
                onChange={() => void handleToggleFillOnly()}
              />
              <span>
                <strong>Fill only</strong>
                <span className="text-muted text-sm">Fill DOCA forms without submitting — no RDP needed to toggle.</span>
              </span>
            </label>
          </div>
        </section>

        <section className="automation-worker-logs">
          <div className="automation-worker-log-tabs" role="tablist" aria-label="Worker logs">
            {([
              ['activity', 'Activity'],
              ['captcha', 'Captcha OCR'],
              ['sessions', 'DOCA sessions'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeLogTab === id}
                className={activeLogTab === id ? 'automation-worker-log-tab automation-worker-log-tab--active' : 'automation-worker-log-tab'}
                onClick={() => setActiveLogTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeLogTab === 'activity' && (
            <div role="tabpanel" className="automation-worker-log-panel">
              {logs.length === 0 ? (
                <p className="text-muted text-sm">No activity logs yet. Logs appear when the worker reports status changes.</p>
              ) : (
                <ul className="automation-worker-log-list">
                  {logs.map(entry => (
                    <li key={entry.id} className={`automation-worker-log-item automation-worker-log-item--${entry.level}`}>
                      <time>{formatTimestamp(entry.createdAt)}</time>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activeLogTab === 'captcha' && (
            <div role="tabpanel" className="automation-worker-log-panel automation-worker-log-panel--captcha">
              {captchaAttempts.length === 0 ? (
                <p className="text-muted text-sm">No captcha OCR attempts recorded yet.</p>
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
            <div role="tabpanel" className="automation-worker-log-panel">
              {sessions.length === 0 ? (
                <p className="text-muted text-sm">No DOCA session logout events yet. Sessions are recorded when the worker detects a logout.</p>
              ) : (
                <ul className="automation-worker-session-list">
                  {sessions.map(session => (
                    <li key={session.id} className="automation-worker-session-item">
                      <div>
                        <strong>{formatDuration(session.durationSeconds)}</strong>
                        <span className="text-muted text-sm"> logged in → logged out</span>
                      </div>
                      <div className="text-muted text-sm">
                        {formatTimestamp(session.loggedInAt)} → {formatTimestamp(session.loggedOutAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
