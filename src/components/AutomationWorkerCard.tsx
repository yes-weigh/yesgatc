import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Clock,
  ImageIcon,
  Pause,
  Play,
  RefreshCw,
  Save,
  Search,
  Server,
  Shield,
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
  type AutomationWorkerCredentialsForm,
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
  const [credentials, setCredentials] = useState<AutomationWorkerCredentialsForm>({
    superAdminAadhar: '',
    superAdminPassword: '',
    docaEmail: '',
    docaPassword: '',
    captchaApiKey: '',
  });
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

  useEffect(() => {
    if (!remote) return;
    setCredentials(prev => ({
      superAdminAadhar: remote.superAdminAadhar || prev.superAdminAadhar,
      docaEmail: remote.docaEmail || prev.docaEmail,
      superAdminPassword: '',
      docaPassword: '',
      captchaApiKey: '',
    }));
  }, [remote?.superAdminAadhar, remote?.docaEmail]);

  const pushRemote = async (
    patch: Partial<AutomationWorkerRemoteControl> & Partial<AutomationWorkerCredentialsForm>,
    options?: { incrementCommand?: boolean; incrementCredentials?: boolean },
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

  const handleSaveCredentials = async () => {
    const hasCredentialField =
      credentials.superAdminAadhar.trim() ||
      credentials.superAdminPassword.trim() ||
      credentials.docaEmail.trim() ||
      credentials.docaPassword.trim() ||
      credentials.captchaApiKey.trim();

    if (!hasCredentialField) {
      setError('Enter at least one credential field to push to the remote worker.');
      return;
    }

    await pushRemote(
      {
        superAdminAadhar: credentials.superAdminAadhar.trim(),
        superAdminPassword: credentials.superAdminPassword,
        docaEmail: credentials.docaEmail.trim(),
        docaPassword: credentials.docaPassword,
        captchaApiKey: credentials.captchaApiKey.trim(),
      },
      { incrementCredentials: true },
    );

    setCredentials(prev => ({
      ...prev,
      superAdminPassword: '',
      docaPassword: '',
      captchaApiKey: '',
    }));
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

        <section className="automation-worker-credentials mb-6">
          <h3 className="automation-worker-section-title"><Shield className="inline-icon" /> Remote credentials</h3>
          <p className="text-muted text-sm">
            Push updated Super Admin, DOCA portal, or captcha OCR credentials to the worker. Password fields are cleared from Firestore after the worker applies them.
          </p>
          <div className="form-grid automation-worker-credentials-grid">
            <div className="form-group">
              <label htmlFor="worker-super-aadhar">Super Admin Aadhar</label>
              <input
                id="worker-super-aadhar"
                className="input-field text-mono"
                value={credentials.superAdminAadhar}
                onChange={e => setCredentials(prev => ({ ...prev, superAdminAadhar: e.target.value }))}
                disabled={saving}
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label htmlFor="worker-super-password">Super Admin password</label>
              <input
                id="worker-super-password"
                type="password"
                className="input-field"
                value={credentials.superAdminPassword}
                onChange={e => setCredentials(prev => ({ ...prev, superAdminPassword: e.target.value }))}
                disabled={saving}
                autoComplete="new-password"
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="form-group">
              <label htmlFor="worker-doca-email">DOCA email</label>
              <input
                id="worker-doca-email"
                className="input-field"
                value={credentials.docaEmail}
                onChange={e => setCredentials(prev => ({ ...prev, docaEmail: e.target.value }))}
                disabled={saving}
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label htmlFor="worker-doca-password">DOCA password</label>
              <input
                id="worker-doca-password"
                type="password"
                className="input-field"
                value={credentials.docaPassword}
                onChange={e => setCredentials(prev => ({ ...prev, docaPassword: e.target.value }))}
                disabled={saving}
                autoComplete="new-password"
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="form-group automation-worker-credentials-grid__full">
              <label htmlFor="worker-captcha-key">OpenAI captcha API key</label>
              <input
                id="worker-captcha-key"
                type="password"
                className="input-field text-mono"
                value={credentials.captchaApiKey}
                onChange={e => setCredentials(prev => ({ ...prev, captchaApiKey: e.target.value }))}
                disabled={saving}
                autoComplete="new-password"
                placeholder="Leave blank to keep current"
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary mt-3"
            disabled={!remoteReady || saving}
            onClick={() => void handleSaveCredentials()}
          >
            <Save className="inline-icon" />
            {saving ? 'Sending…' : 'Push credentials to worker'}
          </button>
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
            <div role="tabpanel" className="automation-worker-log-panel">
              {captchaAttempts.length === 0 ? (
                <p className="text-muted text-sm">No captcha OCR attempts recorded yet.</p>
              ) : (
                <ul className="automation-worker-captcha-list">
                  {captchaAttempts.map(attempt => (
                    <li
                      key={attempt.id}
                      className={`automation-worker-captcha-item${attempt.success ? '' : ' automation-worker-captcha-item--failed'}`}
                    >
                      <div className="automation-worker-captcha-meta">
                        <time>{formatTimestamp(attempt.createdAt)}</time>
                        <span className="text-mono">{attempt.resolvedText || '(empty OCR)'}</span>
                        <span className="text-muted text-sm">
                          {attempt.ocrProvider} · attempt {attempt.attemptNumber} · {attempt.outcome}
                        </span>
                      </div>
                      {attempt.imageUrl ? (
                        <a href={attempt.imageUrl} target="_blank" rel="noreferrer" className="automation-worker-captcha-image-link">
                          <img src={attempt.imageUrl} alt={`Captcha resolved as ${attempt.resolvedText || 'unknown'}`} loading="lazy" />
                        </a>
                      ) : (
                        <div className="automation-worker-captcha-placeholder"><ImageIcon aria-hidden /></div>
                      )}
                    </li>
                  ))}
                </ul>
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
