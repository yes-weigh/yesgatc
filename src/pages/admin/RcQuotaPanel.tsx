import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { Save } from 'lucide-react';
import { db } from '../../firebase';
import { parseQuotaInput } from '../../lib/yesoneInboundData';

type QuotaDraft = {
  uid: string;
  companyName: string;
  rcCode: string;
  ovQuota: string;
  ovQuotaUsed: string;
};

export function RcQuotaPanel() {
  const [quotas, setQuotas] = useState<QuotaDraft[]>([]);
  const [savedQuotas, setSavedQuotas] = useState<QuotaDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'rc_admin')),
      snap => {
        const rows = snap.docs
          .map(item => {
            const data = item.data();
            return {
              uid: item.id,
              companyName: String(data.companyName || data.username || 'RC').trim(),
              rcCode: String(data.rcCode || '').trim(),
              ovQuota: data.ovQuota == null || data.ovQuota === '' ? '' : String(data.ovQuota),
              ovQuotaUsed: data.ovQuotaUsed == null || data.ovQuotaUsed === '' ? '' : String(data.ovQuotaUsed),
            } satisfies QuotaDraft;
          })
          .sort((a, b) => a.companyName.localeCompare(b.companyName));
        setQuotas(rows);
        setSavedQuotas(rows);
        setLoading(false);
      },
      () => {
        setError('Could not load RC quota.');
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const dirty = useMemo(() => {
    if (quotas.length !== savedQuotas.length) return true;
    const quotaById = new Map(savedQuotas.map(row => [row.uid, row]));
    return quotas.some(row => {
      const prev = quotaById.get(row.uid);
      if (!prev) return true;
      return row.ovQuota !== prev.ovQuota || row.ovQuotaUsed !== prev.ovQuotaUsed;
    });
  }, [quotas, savedQuotas]);

  const patchQuota = (uid: string, patch: Partial<QuotaDraft>) => {
    setSaved(false);
    setQuotas(rows => rows.map(row => (row.uid === uid ? { ...row, ...patch } : row)));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const quotaById = new Map(savedQuotas.map(row => [row.uid, row]));
      for (const row of quotas) {
        const prev = quotaById.get(row.uid);
        if (prev && row.ovQuota === prev.ovQuota && row.ovQuotaUsed === prev.ovQuotaUsed) continue;
        const quota = parseQuotaInput(row.ovQuota);
        const used = parseQuotaInput(row.ovQuotaUsed);
        if (row.ovQuota.trim() && quota == null) {
          throw new Error(`RC quota for ${row.companyName} must be a number.`);
        }
        if (row.ovQuotaUsed.trim() && used == null) {
          throw new Error(`Used for ${row.companyName} must be a number.`);
        }
        batch.update(doc(db, 'users', row.uid), {
          ovQuota: quota,
          ovQuotaUsed: used,
          ovQuotaUpdatedAt: new Date().toISOString(),
          ovQuotaSource: 'admin',
          updatedAt: new Date().toISOString(),
        });
      }
      await batch.commit();
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save RC quota.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel glass" aria-label="RC quota" onSubmit={event => void handleSave(event)}>
      {error ? <div className="login-error">{error}</div> : null}
      {saved ? <p className="text-muted text-sm">Saved.</p> : null}
      {quotas.length > 0 ? (
        <section className="admin-setting-yesone-section">
          <div className="admin-setting-yesone-table-wrap">
            <table className="admin-setting-yesone-table">
              <thead>
                <tr>
                  <th>RC</th>
                  <th>Quota</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {quotas.map(row => (
                  <tr key={row.uid}>
                    <td>
                      {row.companyName}
                      {row.rcCode ? <span className="admin-setting-yesone-sub">{row.rcCode}</span> : null}
                    </td>
                    <td>
                      <input
                        className="input-field text-mono"
                        inputMode="numeric"
                        value={row.ovQuota}
                        onChange={event => patchQuota(row.uid, { ovQuota: event.target.value })}
                        aria-label={`RC quota for ${row.companyName}`}
                        disabled={saving}
                      />
                    </td>
                    <td>
                      <input
                        className="input-field text-mono"
                        inputMode="numeric"
                        value={row.ovQuotaUsed}
                        onChange={event => patchQuota(row.uid, { ovQuotaUsed: event.target.value })}
                        aria-label={`Used for ${row.companyName}`}
                        disabled={saving}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary flex items-center gap-2"
        disabled={saving || loading || !dirty}
      >
        {saving ? <span className="spinner-inline" /> : <Save size={16} aria-hidden />}
        Save
      </button>
    </form>
  );
}
