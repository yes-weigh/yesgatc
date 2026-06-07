import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { LaboratoryMenu } from './LaboratoryMenu';
import {
  buildLaboratorySettingsPatch,
  EMPTY_LABORATORY_SETTINGS,
  LABORATORY_FIELDS,
  laboratorySettingsFromUser,
  validateLaboratorySettings,
  type LaboratoryFieldKey,
  type LaboratorySettings,
} from '../lib/rcLaboratoryFields';

interface LaboratorySettingsFormProps {
  userId: string;
  formId: string;
  idPrefix?: string;
  onLoadingChange?: (loading: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

export const LaboratorySettingsForm: React.FC<LaboratorySettingsFormProps> = ({
  userId,
  formId,
  idPrefix = 'laboratory',
  onLoadingChange,
  onSavingChange,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<LaboratorySettings>(EMPTY_LABORATORY_SETTINGS);

  const sealField = LABORATORY_FIELDS[0]!;

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      setLoading(true);
      setError('');
      setSaved(false);
      try {
        const snap = await getDoc(doc(db, 'users', userId));
        setValues(laboratorySettingsFromUser(snap.exists() ? snap.data() : null));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load laboratory settings.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [userId]);

  const patchField = (key: LaboratoryFieldKey, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

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
      await updateDoc(doc(db, 'users', userId), patch);
      setValues(laboratorySettingsFromUser(patch));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'permission-denied') {
        setError(
          'Missing or insufficient permissions. Deploy Firestore rules: firebase deploy --only firestore:rules',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save laboratory settings.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-6">
        <span className="spinner-inline" />
      </div>
    );
  }

  return (
    <form id={formId} onSubmit={handleSave} className="rc-laboratory-form">
      <div className="rc-laboratory-seal-field">
        <label htmlFor={`${idPrefix}-${sealField.key}`} className="rc-laboratory-seal-label">
          {sealField.label}
        </label>
        <input
          id={`${idPrefix}-${sealField.key}`}
          type="text"
          className={`input-field rc-laboratory-seal-input${sealField.mono ? ' font-mono' : ''}`}
          value={values[sealField.key]}
          onChange={e => patchField(sealField.key, e.target.value)}
          placeholder={sealField.placeholder}
          disabled={saving}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="rc-laboratory-seal-hint mb-0">{sealField.hint}.</p>
      </div>

      <LaboratoryMenu />

      {error && (
        <p className="rc-form-topbar-error text-sm mb-0 mt-3" role="alert">
          {error}
        </p>
      )}

      {saved && <p className="text-green text-xs mb-0 mt-3">Laboratory settings saved.</p>}
    </form>
  );
};
