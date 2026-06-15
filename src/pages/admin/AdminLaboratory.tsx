import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
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

  if (listLoading) {
    return (
      <div className="fade-in page-content page-content--laboratory-dashboard">
        <div className="text-center py-6">
          <span className="spinner-inline" />
        </div>
      </div>
    );
  }

  if (centres.length === 0) {
    return (
      <div className="fade-in page-content page-content--laboratory-dashboard">
        <p className="text-muted m-0">No regional centres found.</p>
      </div>
    );
  }

  return (
    <div className="fade-in page-content page-content--laboratory-dashboard">
      {selectedRcId && (
        <LaboratorySettingsForm
          key={selectedRcId}
          userId={selectedRcId}
          idPrefix={`admin-laboratory-${selectedRcId}`}
          configSubtitle="View laboratory seal ID for any regional centre."
          showBottomNav
          bottomNavBasePath="/admin"
          onLoadingChange={setFormLoading}
          configExtras={
            <>
              {listError && (
                <p className="rc-form-topbar-error text-sm mt-2 mb-0" role="alert">
                  {listError}
                </p>
              )}
              <div className="laboratory-admin-rc-picker">
                <label className="laboratory-config-seal-label" htmlFor="admin-laboratory-rc">
                  RC centre
                </label>
                <select
                  id="admin-laboratory-rc"
                  className="input-field laboratory-config-seal-input"
                  value={selectedRcId}
                  onChange={event => setSelectedRcId(event.target.value)}
                >
                  {centres.map(centre => (
                    <option key={centre.uid} value={centre.uid}>
                      {centre.label}
                    </option>
                  ))}
                </select>
              </div>
              {selectedLabel && !formLoading && (
                <p className="laboratory-config-seal-hint mb-0">
                  Showing laboratory seal for {selectedLabel}.
                </p>
              )}
            </>
          }
        />
      )}
    </div>
  );
};
