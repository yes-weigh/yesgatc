import React from 'react';
import { Bell, ClipboardCheck, Scale, Upload } from 'lucide-react';
import { RCModulePage } from './RCModulePage';

export const RCUploadCertificate: React.FC = () => (
  <RCModulePage
    title="Upload Certificate"
    icon={<Upload className="inline-icon" />}
  />
);

export const RCLaboratory: React.FC = () => (
  <RCModulePage
    title="Laboratory"
    icon={<Scale className="inline-icon" />}
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
