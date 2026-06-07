import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LaboratoryPageHeader } from '../../components/LaboratoryPageHeader';
import { LaboratorySettingsForm } from '../../components/LaboratorySettingsForm';

export const RCLaboratory: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  if (!user?.uid) return null;

  return (
    <div className="fade-in page-content">
      <div className="panel glass rc-laboratory-panel">
        <LaboratoryPageHeader
          subtitle="Centre defaults — saved here and reused across verification and certificates."
          formId="rc-laboratory-form"
          showSave={!loading}
          saving={saving}
        />

        <div className="panel-body rc-laboratory-body">
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
