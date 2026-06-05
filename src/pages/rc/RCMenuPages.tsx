import React from 'react';
import { Bell, ClipboardCheck, ClipboardList, UserPlus } from 'lucide-react';
import { RCModulePage } from './RCModulePage';

export { RCLaboratory } from './RCLaboratory';

export const NewJobComingSoon: React.FC = () => (
  <RCModulePage
    title="New Job"
    icon={<ClipboardList className="inline-icon" />}
    description="Coming soon."
  />
);

export const RCQualityManagement: React.FC = () => (
  <RCModulePage
    title="Quality Management"
    icon={<ClipboardCheck className="inline-icon" />}
  />
);

export const RCNotifications: React.FC = () => (
  <RCModulePage
    title="Notifications"
    icon={<Bell className="inline-icon" />}
  />
);

export const RCLeads: React.FC = () => (
  <RCModulePage
    title="Leads"
    icon={<UserPlus className="inline-icon" />}
  />
);
