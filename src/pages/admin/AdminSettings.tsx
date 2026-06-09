import React, { useState } from 'react';
import { Plug } from 'lucide-react';
import { AutomationWorkerCard } from '../../components/AutomationWorkerCard';
import { AdminRazorpayTestCard } from '../../components/AdminRazorpayTestCard';
import { RazorpaySettingsCard } from '../../components/RazorpaySettingsCard';
import { ZohoSettingsCard } from '../../components/ZohoSettingsCard';

type IntegrationsTab = 'zoho' | 'razorpay' | 'whatsapp' | 'doca' | 'worker' | 'openai';

const INTEGRATIONS_TABS: {
  id: IntegrationsTab;
  label: string;
  subtitle: string;
  logoSrc: string;
  brandClass: string;
}[] = [
  {
    id: 'zoho',
    label: 'Zoho Books',
    subtitle: 'RV invoicing & settlement',
    logoSrc: '/integrations/zoho-books.svg',
    brandClass: 'admin-integrations-tab--zoho',
  },
  {
    id: 'razorpay',
    label: 'Razorpay',
    subtitle: 'RC wallet recharge',
    logoSrc: '/integrations/razorpay.svg',
    brandClass: 'admin-integrations-tab--razorpay',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    subtitle: 'Notifications & messaging',
    logoSrc: '/integrations/whatsapp.svg',
    brandClass: 'admin-integrations-tab--whatsapp',
  },
  {
    id: 'doca',
    label: 'DOCA',
    subtitle: 'Certificate portal settings',
    logoSrc: '/integrations/doca.svg',
    brandClass: 'admin-integrations-tab--doca',
  },
  {
    id: 'worker',
    label: 'Automation Worker',
    subtitle: 'Remote worker control & logs',
    logoSrc: '/integrations/doca.svg',
    brandClass: 'admin-integrations-tab--doca',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    subtitle: 'AI & vision automation',
    logoSrc: '/integrations/openai.svg',
    brandClass: 'admin-integrations-tab--openai',
  },
];

export const AdminSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<IntegrationsTab>('zoho');

  return (
    <div className="fade-in page-content admin-integrations-page">
      <header className="admin-integrations-header">
        <h1 className="admin-integrations-title">
          <Plug className="inline-icon" aria-hidden />
          Integrations
        </h1>
        <p className="admin-integrations-subtitle text-muted text-sm mb-0">
          Configure third-party services for billing, payments, messaging, certificates, and AI.
        </p>
      </header>

      <div className="admin-integrations-tabs" role="tablist" aria-label="Integrations">
        {INTEGRATIONS_TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`integrations-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`integrations-panel-${tab.id}`}
              className={[
                'admin-integrations-tab',
                tab.brandClass,
                isActive ? 'admin-integrations-tab--active' : '',
              ].filter(Boolean).join(' ')}
              aria-label={tab.label}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="admin-integrations-tab-logo-wrap" aria-hidden>
                <img
                  src={tab.logoSrc}
                  alt=""
                  className="admin-integrations-tab-logo"
                  draggable={false}
                />
              </span>
              <span className="admin-integrations-tab-hint">{tab.subtitle}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'zoho' && (
        <div
          id="integrations-panel-zoho"
          role="tabpanel"
          aria-labelledby="integrations-tab-zoho"
          className="admin-integrations-panel"
        >
          <ZohoSettingsCard className="admin-integrations-section" />
        </div>
      )}

      {activeTab === 'razorpay' && (
        <div
          id="integrations-panel-razorpay"
          role="tabpanel"
          aria-labelledby="integrations-tab-razorpay"
          className="admin-integrations-panel"
        >
          <RazorpaySettingsCard className="admin-integrations-section" />
          <AdminRazorpayTestCard className="admin-integrations-section" />
        </div>
      )}

      {activeTab === 'whatsapp' && (
        <div
          id="integrations-panel-whatsapp"
          role="tabpanel"
          aria-labelledby="integrations-tab-whatsapp"
          className="admin-integrations-panel"
        />
      )}

      {activeTab === 'doca' && (
        <div
          id="integrations-panel-doca"
          role="tabpanel"
          aria-labelledby="integrations-tab-doca"
          className="admin-integrations-panel"
        />
      )}

      {activeTab === 'worker' && (
        <div
          id="integrations-panel-worker"
          role="tabpanel"
          aria-labelledby="integrations-tab-worker"
          className="admin-integrations-panel"
        >
          <AutomationWorkerCard className="admin-integrations-section" />
        </div>
      )}

      {activeTab === 'openai' && (
        <div
          id="integrations-panel-openai"
          role="tabpanel"
          aria-labelledby="integrations-tab-openai"
          className="admin-integrations-panel"
        />
      )}
    </div>
  );
};
