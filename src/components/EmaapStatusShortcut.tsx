import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  subscribeAutomationWorkerStatus,
  type AutomationWorkerStatus,
} from '../lib/automationWorker';

export const EmaapStatusShortcut: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<AutomationWorkerStatus | null>(null);

  useEffect(() => subscribeAutomationWorkerStatus(setStatus), []);

  const loggedIn = status?.docaSessionState === 'logged_in';
  const label = loggedIn ? 'eMAAP logged in' : 'eMAAP login required';
  const canOpenWorker = user?.role === 'super_admin';

  return (
    <button
      type="button"
      className={`emaap-status-shortcut${loggedIn ? ' emaap-status-shortcut--ok' : ' emaap-status-shortcut--warn'}`}
      onClick={canOpenWorker ? () => navigate('/admin/integrations/worker') : undefined}
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
