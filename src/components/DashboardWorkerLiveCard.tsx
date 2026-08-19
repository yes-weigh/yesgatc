import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, RotateCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import {
  DEFAULT_AUTOMATION_WORKER_REMOTE,
  resolveWorkerRuntimeState,
  saveAutomationWorkerRemoteControl,
  subscribeAutomationWorkerRemote,
  subscribeAutomationWorkerStatus,
  type AutomationWorkerRemoteControl,
  type AutomationWorkerStatus,
  type WorkerRuntimeState,
} from '../lib/automationWorker';
import { displayEmaapText } from '../lib/emaapSessionHistory';

const RUNTIME_LABELS: Record<WorkerRuntimeState, string> = {
  idle: 'Idle',
  working: 'Working',
  paused: 'Paused',
  login_required: 'Login required',
  error: 'Error',
  offline: 'Offline',
};

function compactLiveText(value: string): string {
  return displayEmaapText(value)
    .replace(/\beMaap\s+/gi, '')
    .replace(/\bjob\(s\)/gi, 'jobs')
    .replace(/\s+/g, ' ')
    .trim();
}

function heartbeatAge(value: string, now: number): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export const DashboardWorkerLiveCard: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'super_admin';
  const [status, setStatus] = useState<AutomationWorkerStatus | null>(null);
  const [remote, setRemote] = useState<AutomationWorkerRemoteControl>(
    DEFAULT_AUTOMATION_WORKER_REMOTE,
  );
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeAutomationWorkerStatus(setStatus), []);
  useEffect(() => {
    if (!isAdmin) return undefined;
    return subscribeAutomationWorkerRemote(setRemote);
  }, [isAdmin]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const runtime = useMemo(() => resolveWorkerRuntimeState(status), [status]);
  const loggedIn = status?.docaSessionState === 'logged_in';
  const activity = compactLiveText(status?.statusMessage?.trim() || '');
  const machine = status?.machineName?.trim() || 'VPS';
  const beat = heartbeatAge(status?.lastHeartbeatAt || '', now);
  const className = `wl-live wl-live--${runtime}`;
  const offline = runtime === 'offline';

  const handleRestart = async () => {
    if (!isAdmin || !user?.uid || saving) return;
    const ok = await confirm({
      title: 'Restart certificate worker?',
      message: [
        'Clears stuck job locks and re-queues Submitted work.',
        'Does not reboot the VPS. Worker picks it up within ~30 seconds.',
        'Needs the updated Certificate Worker on the VPS.',
      ].join('\n'),
      messageFormat: 'preline',
      confirmLabel: 'Restart',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await saveAutomationWorkerRemoteControl(
        remote,
        { clearJobLocksRevision: (remote.clearJobLocksRevision || 0) + 1 },
        user.uid,
        { incrementCommand: true },
      );
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <>
      <div className="wl-live__head">
        <p className="wl-live__state">{RUNTIME_LABELS[runtime]}</p>
        <div className="wl-live__chips">
          <span className="wl-live__chip" aria-label={`Machine ${machine}`}>
            {machine}
          </span>
          <span
            className={`wl-live__chip${loggedIn ? ' wl-live__chip--ok' : ' wl-live__chip--warn'}`}
            aria-label={loggedIn ? 'Logged in' : 'Login required'}
          >
            {loggedIn ? 'Logged in' : 'Login needed'}
          </span>
          <span className="wl-live__chip" aria-label={`Heartbeat ${beat}`}>
            <Clock size={12} strokeWidth={2.2} aria-hidden />
            {beat}
          </span>
        </div>
      </div>
      {activity ? <p className="wl-live__msg">{activity}</p> : null}
    </>
  );

  if (!isAdmin) {
    return (
      <section className={className} aria-label="Worker status">
        {body}
      </section>
    );
  }

  return (
    <section className={className} aria-label="Worker status">
      {body}
      <div className="wl-live__actions">
        <button
          type="button"
          className="wl-live__restart"
          disabled={saving || offline}
          onClick={() => void handleRestart()}
        >
          <RotateCw size={15} strokeWidth={2.2} aria-hidden />
          {saving ? 'Restarting…' : 'Restart worker'}
        </button>
        <Link to="/admin/integrations/worker" className="wl-live__open">
          Open worker
        </Link>
      </div>
    </section>
  );
};
