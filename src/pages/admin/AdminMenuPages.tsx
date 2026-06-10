import React from 'react';
import { Bell, ClipboardCheck } from 'lucide-react';
import { RCModulePage } from '../rc/RCModulePage';

export { AdminDocaScraping } from './AdminDocaScraping';

export const AdminQualityManagement: React.FC = () => (
  <RCModulePage
    title="Quality Management"
    icon={<ClipboardCheck className="inline-icon" />}
  />
);

export const AdminNotifications: React.FC = () => (
  <RCModulePage
    title="Notifications"
    icon={<Bell className="inline-icon" />}
  />
);
