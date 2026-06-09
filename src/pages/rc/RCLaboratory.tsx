import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LaboratorySettingsForm } from '../../components/LaboratorySettingsForm';

export const RCLaboratory: React.FC = () => {
  const { user } = useAuth();
  const [, setLoading] = useState(true);
  const [, setSaving] = useState(false);

  if (!user?.uid) return null;

  return (
    <div className="fade-in page-content page-content--laboratory-dashboard">
      <LaboratorySettingsForm
        userId={user.uid}
        formId="rc-laboratory-form"
        configSubtitle="Centre defaults — saved here and reused across verification and certificates."
        showBottomNav
        bottomNavBasePath="/rc"
        onLoadingChange={setLoading}
        onSavingChange={setSaving}
      />
    </div>
  );
};
