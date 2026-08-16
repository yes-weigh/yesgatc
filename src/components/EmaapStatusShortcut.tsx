import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import {
  subscribeAutomationWorkerStatus,
  type AutomationWorkerStatus,
} from '../lib/automationWorker';

export const EmaapStatusShortcut: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AutomationWorkerStatus | null>(null);

  useEffect(() => subscribeAutomationWorkerStatus(setStatus), []);

  const loggedIn = status?.docaSessionState === 'logged_in';
  const label = loggedIn ? 'eMAAP logged in' : 'eMAAP login required';

  return (
    <button
      type="button"
      className={`emaap-status-shortcut${loggedIn ? ' emaap-status-shortcut--ok' : ' emaap-status-shortcut--warn'}`}
      onClick={() => navigate('/admin/integrations/worker')}
      title={label}
      aria-label={label}
    >
      <span className="emaap-status-shortcut__text">eMaap</span>
      <span className="emaap-status-shortcut__mark" aria-hidden>
        <ShieldCheck size={18} strokeWidth={2.2} />
      </span>
    </button>
  );
};
