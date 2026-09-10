import React from 'react';
import { Bell } from 'lucide-react';
import { RCModulePage } from '../rc/RCModulePage';
import { RcQuotaPanel, RcQuotaSynButton } from './RcQuotaPanel';

export const AdminNotifications: React.FC = () => (
  <RCModulePage
    title="Notifications"
    icon={<Bell className="inline-icon" />}
  />
);

export const AdminRcQuotaPage: React.FC = () => (
  <div className="fade-in page-content admin-setting-page admin-setting-page--wide">
    <RcQuotaSynButton />
    <RcQuotaPanel />
  </div>
);
