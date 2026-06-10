import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { AutomationWorkerCard } from '../../components/AutomationWorkerCard';
import { AdminRazorpayTestCard } from '../../components/AdminRazorpayTestCard';
import { ListViewBackBar } from '../../components/ListViewBackBar';
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
    label: 'Certificate Worker',
    subtitle: 'Remote DOCA server — status, queue & logs',
    logoSrc: '/integrations/certificate-worker.png',
    brandClass: 'admin-integrations-tab--worker',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    subtitle: 'AI & vision automation',
    logoSrc: '/integrations/openai.svg',
    brandClass: 'admin-integrations-tab--openai',
  },
];

function isIntegrationsTab(value: string | undefined): value is IntegrationsTab {
  return INTEGRATIONS_TABS.some(tab => tab.id === value);
}

function renderIntegrationContent(tabId: IntegrationsTab): React.ReactNode {
  switch (tabId) {
    case 'zoho':
      return <ZohoSettingsCard className="admin-integrations-section" />;
    case 'razorpay':
      return (
        <>
          <RazorpaySettingsCard className="admin-integrations-section" />
          <AdminRazorpayTestCard className="admin-integrations-section" />
        </>
      );
    case 'worker':
      return <AutomationWorkerCard className="admin-integrations-section" />;
    case 'whatsapp':
    case 'doca':
    case 'openai':
      return (
        <p className="text-muted text-sm m-0">
          Settings for this integration are not configured in the web app yet.
        </p>
      );
    default:
      return null;
  }
}

const AdminIntegrationsHub: React.FC = () => {
  const navigate = useNavigate();

  return (
    <>
      <header className="admin-integrations-header">
        <h1 className="admin-integrations-title">
          <Plug className="inline-icon" aria-hidden />
          Integrations
        </h1>
        <p className="admin-integrations-subtitle text-muted text-sm mb-0">
          Configure third-party services for billing, payments, messaging, certificates, and AI.
        </p>
      </header>

      <div className="admin-integrations-tabs" role="list" aria-label="Integrations">
        {INTEGRATIONS_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="listitem"
            className={['admin-integrations-tab', tab.brandClass].filter(Boolean).join(' ')}
            aria-label={tab.label}
            onClick={() => navigate(`/admin/integrations/${tab.id}`)}
          >
            <span className="admin-integrations-tab-logo-wrap" aria-hidden>
              <img
                src={tab.logoSrc}
                alt=""
                className="admin-integrations-tab-logo"
                draggable={false}
              />
            </span>
            <span className="admin-integrations-tab-label">{tab.label}</span>
            <span className="admin-integrations-tab-hint">{tab.subtitle}</span>
          </button>
        ))}
      </div>
    </>
  );
};

const AdminIntegrationDetail: React.FC<{ tabId: IntegrationsTab }> = ({ tabId }) => {
  const navigate = useNavigate();
  const tab = INTEGRATIONS_TABS.find(item => item.id === tabId);

  if (!tab) {
    return null;
  }

  return (
    <>
      <ListViewBackBar
        onBack={() => navigate('/admin/integrations')}
        label="Back to integrations"
      />

      <header className="admin-integrations-detail-header">
        <span className={`admin-integrations-detail-logo-wrap ${tab.brandClass}`} aria-hidden>
          <img src={tab.logoSrc} alt="" className="admin-integrations-tab-logo" draggable={false} />
        </span>
        <div className="admin-integrations-detail-copy">
          <h1 className="admin-integrations-detail-title">{tab.label}</h1>
          <p className="admin-integrations-detail-subtitle text-muted text-sm mb-0">{tab.subtitle}</p>
        </div>
      </header>

      <div className="admin-integrations-panel">{renderIntegrationContent(tabId)}</div>
    </>
  );
};

export const AdminSettings: React.FC = () => {
  const { integrationId } = useParams<{ integrationId?: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (integrationId && !isIntegrationsTab(integrationId)) {
      navigate('/admin/integrations', { replace: true });
    }
  }, [integrationId, navigate]);

  if (integrationId && !isIntegrationsTab(integrationId)) {
    return null;
  }

  return (
    <div className="fade-in page-content admin-integrations-page">
      {integrationId && isIntegrationsTab(integrationId) ? (
        <AdminIntegrationDetail tabId={integrationId} />
      ) : (
        <AdminIntegrationsHub />
      )}
    </div>
  );
};
