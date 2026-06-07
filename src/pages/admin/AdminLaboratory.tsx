import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { LaboratoryPageHeader } from '../../components/LaboratoryPageHeader';
import { LaboratorySettingsForm } from '../../components/LaboratorySettingsForm';
import type { FirestoreUserDoc } from '../../types';

interface RcCentreOption {
  uid: string;
  label: string;
}

export const AdminLaboratory: React.FC = () => {
  const [centres, setCentres] = useState<RcCentreOption[]>([]);
  const [selectedRcId, setSelectedRcId] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');

  const fetchCentres = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const snap = await getDocs(collection(db, 'users'));
      const options = snap.docs
        .map(d => ({ uid: d.id, ...(d.data() as FirestoreUserDoc) }))
        .filter(u => u.role === 'rc_admin')
        .map(u => ({
          uid: u.uid,
          label: u.companyName?.trim() || u.username?.trim() || u.uid,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setCentres(options);
      setSelectedRcId(prev => (prev && options.some(o => o.uid === prev) ? prev : options[0]?.uid ?? ''));
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load regional centres.');
      setCentres([]);
      setSelectedRcId('');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCentres();
  }, [fetchCentres]);

  const selectedLabel = useMemo(
    () => centres.find(c => c.uid === selectedRcId)?.label ?? '',
    [centres, selectedRcId],
  );

  return (
    <div className="fade-in page-content">
      <div className="panel glass rc-laboratory-panel">
        <LaboratoryPageHeader
          subtitle="View and edit laboratory defaults for any regional centre."
          formId="admin-laboratory-form"
          showSave={!listLoading && Boolean(selectedRcId) && !formLoading}
          saving={saving}
        >
          {listError && (
            <p className="rc-form-topbar-error text-sm mt-2 mb-0" role="alert">
              {listError}
            </p>
          )}
        </LaboratoryPageHeader>

        <div className="panel-body rc-laboratory-body">
          {listLoading ? (
            <div className="text-center py-6">
              <span className="spinner-inline" />
            </div>
          ) : centres.length === 0 ? (
            <p className="text-muted m-0">No regional centres found.</p>
          ) : (
            <>
              <div className="verification-list-filter mb-4 max-w-md">
                <label className="verification-list-filter-label" htmlFor="admin-laboratory-rc">
                  RC centre
                </label>
                <select
                  id="admin-laboratory-rc"
                  className="input-field"
                  value={selectedRcId}
                  onChange={e => setSelectedRcId(e.target.value)}
                >
                  {centres.map(centre => (
                    <option key={centre.uid} value={centre.uid}>
                      {centre.label}
                    </option>
                  ))}
                </select>
              </div>
              {selectedRcId && (
                <LaboratorySettingsForm
                  key={selectedRcId}
                  userId={selectedRcId}
                  formId="admin-laboratory-form"
                  idPrefix={`admin-laboratory-${selectedRcId}`}
                  onLoadingChange={setFormLoading}
                  onSavingChange={setSaving}
                />
              )}
              {selectedLabel && !formLoading && (
                <p className="text-muted text-xs mt-3 mb-0">
                  Editing laboratory settings for {selectedLabel}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
