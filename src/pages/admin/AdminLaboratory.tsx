import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { Scale, Save } from 'lucide-react';
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
        <div className="panel-header justify-between">
          <div>
            <h2>
              <Scale className="inline-icon text-blue" /> Laboratory
            </h2>
            <p className="text-muted text-sm mt-1 mb-0">
              View and edit laboratory defaults for any regional centre.
            </p>
            {listError && (
              <p className="rc-form-topbar-error text-sm mt-1 mb-0" role="alert">
                {listError}
              </p>
            )}
          </div>
          {!listLoading && selectedRcId && !formLoading && (
            <button
              type="submit"
              form="admin-laboratory-form"
              className="btn btn-primary flex items-center gap-2 text-sm py-1.5 px-3 shrink-0"
              disabled={saving}
            >
              {saving ? <span className="spinner-inline" /> : <Save size={15} />}
              Save
            </button>
          )}
        </div>

        <div className="panel-body pt-2">
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
