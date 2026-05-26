import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Scale, Save } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import {
  buildLaboratorySettingsPatch,
  EMPTY_LABORATORY_SETTINGS,
  LABORATORY_FIELDS,
  laboratorySettingsFromUser,
  validateLaboratorySettings,
  type LaboratoryFieldKey,
  type LaboratorySettings,
} from '../../lib/rcLaboratoryFields';

export const RCLaboratory: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<LaboratorySettings>(EMPTY_LABORATORY_SETTINGS);

  useEffect(() => {
    if (!user?.uid) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        setValues(laboratorySettingsFromUser(snap.exists() ? snap.data() : null));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load laboratory settings.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [user?.uid]);

  const patchField = (key: LaboratoryFieldKey, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid) return;

    const validationError = validateLaboratorySettings(values);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const patch = buildLaboratorySettingsPatch(values);
      await updateDoc(doc(db, 'users', user.uid), patch);
      setValues(laboratorySettingsFromUser(patch));
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
        <div className="panel-header justify-between">
          <div>
            <h2>
              <Scale className="inline-icon text-blue" /> Laboratory
            </h2>
            <p className="text-muted text-sm mt-1 mb-0">
              Centre defaults — saved here and reused across verification and certificates.
            </p>
          </div>
          {!loading && (
            <button
              type="submit"
              form="rc-laboratory-form"
              className="btn btn-primary flex items-center gap-2 text-sm py-1.5 px-3 shrink-0"
              disabled={saving}
            >
              {saving ? <span className="spinner-inline" /> : <Save size={15} />}
              Save
            </button>
          )}
        </div>

        <div className="panel-body pt-2">
          {loading ? (
            <div className="text-center py-6">
              <span className="spinner-inline" />
            </div>
          ) : (
            <form id="rc-laboratory-form" onSubmit={handleSave} className="rc-laboratory-form">
              <div className="rc-laboratory-sheet" role="group" aria-label="Laboratory data fields">
                <div className="rc-laboratory-sheet-head">
                  <span>Field</span>
                  <span>Value</span>
                  <span className="rc-laboratory-sheet-head-note">Used for</span>
                </div>
                {LABORATORY_FIELDS.map(field => (
                  <div key={field.key} className="rc-laboratory-field-row">
                    <label htmlFor={`laboratory-${field.key}`} className="rc-laboratory-field-label">
                      {field.label}
                    </label>
                    <input
                      id={`laboratory-${field.key}`}
                      type="text"
                      className={`input-field rc-laboratory-field-input${field.mono ? ' font-mono' : ''}`}
                      value={values[field.key]}
                      onChange={e => patchField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      disabled={saving}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="rc-laboratory-field-hint">{field.hint}</span>
                  </div>
                ))}
              </div>

              {error && (
                <p className="rc-form-topbar-error text-sm mb-0 mt-2" role="alert">
                  {error}
                </p>
              )}

              {saved && (
                <p className="text-green text-xs mb-0 mt-2">Laboratory settings saved.</p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
