import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LaboratorySettingsForm } from '../../components/LaboratorySettingsForm';

export const RCLaboratory: React.FC = () => {
  const { user } = useAuth();
  const [, setLoading] = useState(true);

  if (!user?.uid) return null;

  return (
    <div className="fade-in page-content page-content--laboratory-dashboard">
      <LaboratorySettingsForm
        userId={user.uid}
        configSubtitle="Centre seal ID — shown on verifications and certificates (read-only)."
        showBottomNav
        bottomNavBasePath="/rc"
        onLoadingChange={setLoading}
      />
    </div>
  );
};
