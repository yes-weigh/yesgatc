import React from 'react';
import { Bell } from 'lucide-react';
import { RCModulePage } from '../rc/RCModulePage';

export const AdminNotifications: React.FC = () => (
  <RCModulePage
    title="Notifications"
    icon={<Bell className="inline-icon" />}
  />
);
