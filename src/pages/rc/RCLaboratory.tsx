import React, { useState } from 'react';
import { LaboratorySettingsForm } from '../../components/LaboratorySettingsForm';
import { useRcScope, useRoleBasePath } from '../../lib/roleScope';

export const RCLaboratory: React.FC = () => {
  const { rcUid } = useRcScope();
  const basePath = useRoleBasePath();
  const [, setLoading] = useState(true);

  if (!rcUid) return null;

  const bottomNavBasePath = basePath === '/admin' ? '/admin' : basePath === '/vct' ? '/vct' : '/rc';

  return (
    <div className="fade-in page-content page-content--laboratory-dashboard">
      <LaboratorySettingsForm
        userId={rcUid}
        configSubtitle="Centre seal ID — shown on verifications and certificates (read-only)."
        showBottomNav
        bottomNavBasePath={bottomNavBasePath}
        onLoadingChange={setLoading}
      />
    </div>
  );
};
