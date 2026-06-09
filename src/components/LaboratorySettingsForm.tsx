import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { LaboratoryBottomNav } from './LaboratoryBottomNav';
import { LaboratoryConfigCard } from './LaboratoryConfigCard';
import { LaboratoryDocumentsSection } from './LaboratoryDocumentsSection';
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

type LaboratorySettingsFormProps = {
  userId: string;
  formId: string;
  idPrefix?: string;
  configSubtitle: string;
  showBottomNav?: boolean;
  bottomNavBasePath?: '/rc' | '/admin';
  onLoadingChange?: (loading: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  configExtras?: React.ReactNode;
};

export const LaboratorySettingsForm: React.FC<LaboratorySettingsFormProps> = ({
  userId,
  formId,
  idPrefix = 'laboratory',
  configSubtitle,
  showBottomNav = false,
  bottomNavBasePath = '/rc',
  onLoadingChange,
  onSavingChange,
  configExtras,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<LaboratorySettings>(EMPTY_LABORATORY_SETTINGS);

  const sealField = LABORATORY_FIELDS[0]!;
  const sealInputId = `${idPrefix}-${sealField.key}`;

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

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

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
      <div className="laboratory-dashboard laboratory-dashboard--loading">
        <div className="text-center py-6">
          <span className="spinner-inline" />
        </div>
      </div>
    );
  }

  return (
    <div className={`laboratory-dashboard${showBottomNav ? ' laboratory-dashboard--with-bottom-nav' : ''}`}>
      <form id={formId} onSubmit={handleSave} className="laboratory-dashboard-form">
        <LaboratoryConfigCard
          subtitle={configSubtitle}
          formId={formId}
          sealField={sealField}
          sealValue={values[sealField.key]}
          sealInputId={sealInputId}
          saving={saving}
          showSave
          onSealChange={value => patchField(sealField.key, value)}
        >
          {configExtras}
        </LaboratoryConfigCard>

        {error && (
          <p className="rc-form-topbar-error text-sm mb-0" role="alert">
            {error}
          </p>
        )}

        {saved && <p className="text-green text-xs mb-0">Laboratory settings saved.</p>}
      </form>

      <section className="laboratory-menu-section" aria-labelledby="laboratory-menu-heading">
        <div className="laboratory-section-head">
          <h3 id="laboratory-menu-heading" className="laboratory-section-title mb-0">
            Laboratory Menu
          </h3>
        </div>
        <LaboratoryMenu />
      </section>

      <LaboratoryDocumentsSection />

      {showBottomNav && <LaboratoryBottomNav basePath={bottomNavBasePath} />}
    </div>
  );
};
