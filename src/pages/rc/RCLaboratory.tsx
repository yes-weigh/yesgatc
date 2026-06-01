import React, { useState } from 'react';
import { Scale, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LaboratorySettingsForm } from '../../components/LaboratorySettingsForm';

export const RCLaboratory: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  if (!user?.uid) return null;

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
          <LaboratorySettingsForm
            userId={user.uid}
            formId="rc-laboratory-form"
            onLoadingChange={setLoading}
            onSavingChange={setSaving}
          />
        </div>
      </div>
    </div>
  );
};
