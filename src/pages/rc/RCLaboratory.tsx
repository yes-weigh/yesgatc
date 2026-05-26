import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Scale, Save, ShieldCheck } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_LABORATORY_SEAL_IDENTIFICATION,
  resolveLaboratorySealIdentification,
} from '../../lib/rcLaboratoryFields';

export const RCLaboratory: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [sealIdentification, setSealIdentification] = useState(DEFAULT_LABORATORY_SEAL_IDENTIFICATION);

  useEffect(() => {
    if (!user?.uid) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        setSealIdentification(
          resolveLaboratorySealIdentification(
            snap.exists() ? snap.data() : null,
          ),
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load laboratory settings.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user?.uid]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid) return;

    const trimmed = sealIdentification.trim();
    if (!trimmed) {
      setError('Seal identification is required.');
      return;
    }

    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        laboratorySealIdentification: trimmed,
      });
      setSealIdentification(trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'permission-denied') {
        setError('Missing or insufficient permissions. Deploy Firestore rules: firebase deploy --only firestore:rules');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save laboratory settings.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in page-content">
      <div className="panel glass rc-laboratory-panel">
        <div className="panel-header">
          <div>
            <h2>
              <Scale className="inline-icon text-blue" /> Laboratory
            </h2>
            <p className="text-muted text-sm mt-1 mb-0">
              Central settings applied across verification workflows for your centre.
            </p>
          </div>
        </div>

        <div className="panel-body">
          {loading ? (
            <div className="text-center py-8">
              <span className="spinner-inline" />
            </div>
          ) : (
            <form onSubmit={handleSave} className="rc-laboratory-form">
              <div className="rc-laboratory-intro glass">
                <ShieldCheck size={20} className="text-blue shrink-0" />
                <p className="mb-0 text-sm">
                  The seal identification below is prefilled on every device during verification.
                  Update it here when your laboratory seal changes — individual device Seal ID fields
                  on the verification form are read-only.
                </p>
              </div>

              <div className="form-group mb-0">
                <label htmlFor="laboratory-seal-id">Seal identification</label>
                <input
                  id="laboratory-seal-id"
                  type="text"
                  className="input-field font-mono"
                  value={sealIdentification}
                  onChange={e => setSealIdentification(e.target.value)}
                  placeholder={DEFAULT_LABORATORY_SEAL_IDENTIFICATION}
                  disabled={saving}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-muted text-xs mt-1 mb-0">
                  Default for new centres: {DEFAULT_LABORATORY_SEAL_IDENTIFICATION}
                </p>
              </div>

              {error && (
                <p className="rc-form-topbar-error text-sm mb-0" role="alert">
                  {error}
                </p>
              )}

              {saved && (
                <p className="text-green text-sm mb-0">Laboratory settings saved.</p>
              )}

              <div className="rc-laboratory-actions">
                <button type="submit" className="btn btn-primary flex items-center gap-2" disabled={saving}>
                  {saving ? <span className="spinner-inline" /> : <Save size={16} />}
                  Save seal identification
                </button>
                <Link to="/rc/verification" className="btn btn-secondary">
                  Go to Verification
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
