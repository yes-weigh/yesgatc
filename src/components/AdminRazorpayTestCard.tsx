import React, { useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, ExternalLink, Globe, Play } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { RvPaymentPanel } from './RvPaymentPanel';
import { RV_PAYMENT_TEST_BREAKDOWN } from '../lib/rvPaymentAmount';

type AdminRazorpayTestCardProps = {
  className?: string;
};

export const AdminRazorpayTestCard: React.FC<AdminRazorpayTestCardProps> = ({ className = '' }) => {
  const { user } = useAuth();
  const [testOpen, setTestOpen] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  const siteHost = useMemo(
    () => (typeof window !== 'undefined' ? window.location.host : ''),
    [],
  );

  if (!user?.uid) return null;

  return (
    <>
      <div className={`panel glass mt-6 admin-razorpay-test-card${className ? ` ${className}` : ''}`}>
        <div className="panel-header">
          <h2>
            <CreditCard className="inline-icon" /> Razorpay integration test
          </h2>
        </div>
        <div className="panel-body">
          <div className="admin-razorpay-test-whitelist">
            <div className="admin-razorpay-test-whitelist-head">
              <Globe size={16} aria-hidden />
              <span>Site host</span>
            </div>
            <p className="admin-razorpay-test-whitelist-host mb-0">
              <code>{siteHost || '—'}</code>
            </p>
            <a
              href="https://dashboard.razorpay.com/app/website-app-settings/websites"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-razorpay-test-dashboard-link"
            >
              Open Razorpay website settings
              <ExternalLink size={14} aria-hidden />
            </a>
          </div>

          {lastSuccess ? (
            <p className="admin-razorpay-test-success mb-4" role="status">
              <CheckCircle2 size={16} aria-hidden />
              {lastSuccess}
            </p>
          ) : null}

          <button
            type="button"
            className="btn btn-primary admin-razorpay-test-btn"
            onClick={() => {
              setLastSuccess(null);
              setTestOpen(true);
            }}
          >
            <Play size={16} aria-hidden />
            Test payment gateway
          </button>
        </div>
      </div>

      {testOpen ? (
        <RvPaymentPanel
          testMode
          breakdown={RV_PAYMENT_TEST_BREAKDOWN}
          rcId={user.uid}
          onPaid={async () => {
            setLastSuccess(
              'Razorpay test payment succeeded — keys, order API, checkout, and site whitelist look good.',
            );
            setTestOpen(false);
          }}
          onClose={() => setTestOpen(false)}
        />
      ) : null}
    </>
  );
};
