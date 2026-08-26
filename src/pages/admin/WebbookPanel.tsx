import React, { useEffect, useMemo, useState } from 'react';
import { Save, Send, Webhook } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
} from '../../lib/appSettings';
import { callableErrorMessage } from '../../lib/zohoRvInvoice';
import { testYesoneWebhook } from '../../lib/yesoneWebhookClient';
import {
  normalizeYesoneWebhookUrl,
  validateYesoneWebhookUrlInput,
  yesonePushCounts,
  type YesonePushLog,
} from '../../lib/yesoneWebhookSettings';

function formatPushLog(log: YesonePushLog): string {
  const remaining = Math.max(0, log.certTotal - log.certSent - log.certFailed);
  const parts = [
    `RC ${log.rcSent + log.rcFailed}/${log.rcTotal}`,
    log.rcFailed ? `${log.rcFailed} RC failed` : null,
    `certs ${log.certSent + log.certFailed}/${log.certTotal} in yesgatc`,
    log.certLatestSequence ? `latest serial ${log.certLatestSequence}` : null,
    log.certFailed ? `${log.certFailed} cert failed` : null,
    remaining && log.incomplete ? `${remaining} remaining` : null,
    log.certSkipped ? `${log.certSkipped} skipped` : null,
    log.incomplete ? 'stopped early' : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function WebbookPanel() {
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [pushLog, setPushLog] = useState<YesonePushLog | null>(null);

  useEffect(() => {
    if (appSettingsLoading) return;
    setUrl(appSettings.yesoneWebhookUrl);
  }, [appSettings.yesoneWebhookUrl, appSettingsLoading]);

  useEffect(() => {
    if (appSettings.yesoneLastPushLog) setPushLog(appSettings.yesoneLastPushLog);
  }, [appSettings.yesoneLastPushLog]);

  const displayLog = useMemo(() => {
    if (testing && appSettings.yesonePushProgress) return appSettings.yesonePushProgress;
    return pushLog;
  }, [testing, appSettings.yesonePushProgress, pushLog]);

  const counts = displayLog ? yesonePushCounts(displayLog) : null;

  const persistUrl = async (nextUrl: string, enabled: boolean) => {
    await setDoc(
      doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
      {
        yesoneWebhookUrl: nextUrl,
        yesoneWebhookEnabled: enabled,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    const nextUrl = normalizeYesoneWebhookUrl(url);
    const invalid = validateYesoneWebhookUrlInput(nextUrl);
    if (invalid) {
      setError(invalid);
      return;
    }

    setSaving(true);
    try {
      await persistUrl(nextUrl, Boolean(nextUrl));
      setUrl(nextUrl);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save yesone URL.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setError('');
    setSaved(false);
    const nextUrl = normalizeYesoneWebhookUrl(url);
    const invalid = validateYesoneWebhookUrlInput(nextUrl);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!nextUrl) {
      setError('Paste the yesone URL first.');
      return;
    }

    setTesting(true);
    try {
      if (nextUrl !== appSettings.yesoneWebhookUrl) {
        await persistUrl(nextUrl, true);
        setUrl(nextUrl);
      }
      const result = await testYesoneWebhook();
      setPushLog(result);
    } catch (err: unknown) {
      setError(callableErrorMessage(err) || 'Push failed.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="panel glass">
      <div className="panel-header">
        <h2>
          <Webhook className="inline-icon" aria-hidden />
          Webbook
        </h2>
      </div>
      <form onSubmit={event => void handleSave(event)}>
        {error ? <div className="login-error">{error}</div> : null}
        {saved ? <p className="text-muted text-sm">Yesone URL saved.</p> : null}
        <div className="form-group">
          <label htmlFor="yesone-webhook-url">Yesone URL</label>
          <input
            id="yesone-webhook-url"
            type="url"
            className="input-field text-mono"
            value={url}
            onChange={event => {
              setSaved(false);
              setUrl(event.target.value);
            }}
            placeholder="https://yesone.example/api/webhooks/yesgatc"
            autoComplete="off"
            spellCheck={false}
            disabled={saving || testing || appSettingsLoading}
          />
        </div>
        <div className="admin-setting-webbook-actions">
          <button
            type="submit"
            className="btn btn-primary flex items-center gap-2"
            disabled={saving || testing || appSettingsLoading}
          >
            {saving ? <span className="spinner-inline" /> : <Save size={16} aria-hidden />}
            Save
          </button>
          <button
            type="button"
            className="btn btn-secondary flex items-center gap-2"
            onClick={() => void handleTest()}
            disabled={saving || testing || appSettingsLoading}
          >
            {testing ? <span className="spinner-inline" /> : <Send size={16} aria-hidden />}
            {testing && counts && counts.total > 0 ? `${counts.done}/${counts.total}` : testing ? 'Pushing…' : 'Send test'}
          </button>
        </div>
        {displayLog ? (
          <div className="admin-setting-webbook-log" role="status">
            <h3>Log status</h3>
            {counts && counts.total > 0 ? (
              <p className="admin-setting-webbook-log-count">{counts.done}/{counts.total}</p>
            ) : null}
            <p className={displayLog.ok ? 'text-muted' : undefined}>{formatPushLog(displayLog)}</p>
            {displayLog.errors.length > 0 ? (
              <ul className="admin-setting-webbook-log-errors">
                {displayLog.errors.map(item => (
                  <li key={`${item.kind}-${item.id}`}>
                    {item.kind} {item.id}: {item.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}
