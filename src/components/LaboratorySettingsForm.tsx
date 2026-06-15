import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { LaboratoryBottomNav } from './LaboratoryBottomNav';
import { LaboratoryConfigCard } from './LaboratoryConfigCard';
import { LaboratoryDocumentsSection } from './LaboratoryDocumentsSection';
import { LaboratoryMenu } from './LaboratoryMenu';
import {
  EMPTY_LABORATORY_SETTINGS,
  LABORATORY_FIELDS,
  laboratorySettingsFromUser,
  type LaboratorySettings,
} from '../lib/rcLaboratoryFields';

type LaboratorySettingsFormProps = {
  userId: string;
  idPrefix?: string;
  configSubtitle: string;
  showBottomNav?: boolean;
  bottomNavBasePath?: '/rc' | '/admin';
  onLoadingChange?: (loading: boolean) => void;
  configExtras?: React.ReactNode;
};

export const LaboratorySettingsForm: React.FC<LaboratorySettingsFormProps> = ({
  userId,
  configSubtitle,
  showBottomNav = false,
  bottomNavBasePath = '/rc',
  onLoadingChange,
  configExtras,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<LaboratorySettings>(EMPTY_LABORATORY_SETTINGS);

  const sealField = LABORATORY_FIELDS[0]!;

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      setLoading(true);
      setError('');
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
      <LaboratoryConfigCard
        subtitle={configSubtitle}
        sealField={sealField}
        sealValue={values[sealField.key]}
      >
        {configExtras}
      </LaboratoryConfigCard>

      {error && (
        <p className="rc-form-topbar-error text-sm mb-0" role="alert">
          {error}
        </p>
      )}

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
