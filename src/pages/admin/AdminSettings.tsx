import React from 'react';
import { Settings } from 'lucide-react';
import { AdminRazorpayTestCard } from '../../components/AdminRazorpayTestCard';
import { RvPaymentSettingsCard } from '../../components/RvPaymentSettingsCard';
import { ZohoSettingsCard } from '../../components/ZohoSettingsCard';

export const AdminSettings: React.FC = () => (
  <div className="fade-in page-content admin-settings-page">
    <header className="admin-settings-header">
      <h1 className="admin-settings-title">
        <Settings className="inline-icon" aria-hidden />
        Settings
      </h1>
    </header>

    <RvPaymentSettingsCard className="admin-settings-section" />
    <ZohoSettingsCard className="admin-settings-section" />
    <AdminRazorpayTestCard className="admin-settings-section" />
  </div>
);
