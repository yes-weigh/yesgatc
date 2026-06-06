import React, { useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, ExternalLink, Globe, Play } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { RvPaymentPanel } from './RvPaymentPanel';
import { RV_PAYMENT_TEST_BREAKDOWN } from '../lib/rvPaymentAmount';

export const AdminRazorpayTestCard: React.FC = () => {
  const { user } = useAuth();
  const [testOpen, setTestOpen] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  const siteOrigin = useMemo(
    () => (typeof window !== 'undefined' ? window.location.origin : ''),
    [],
  );
  const siteHost = useMemo(
    () => (typeof window !== 'undefined' ? window.location.host : ''),
    [],
  );

  if (!user?.uid) return null;

  return (
    <>
      <div className="panel glass mt-6 admin-razorpay-test-card">
        <div className="panel-header">
          <h2>
            <CreditCard className="inline-icon" /> Razorpay integration test
          </h2>
        </div>
        <div className="panel-body">
          <p className="text-muted text-sm mb-4">
            Confirm server keys, order creation, UPI checkout, and site whitelist without submitting
            a real RV verification. Uses a ₹1 test order marked as admin-only in payment logs.
          </p>

          <div className="admin-razorpay-test-whitelist">
            <div className="admin-razorpay-test-whitelist-head">
              <Globe size={16} aria-hidden />
              <span>Whitelist this site in Razorpay</span>
            </div>
            <p className="admin-razorpay-test-whitelist-host mb-0">
              <code>{siteHost || '—'}</code>
            </p>
            <p className="text-muted text-sm mb-0">
              Razorpay Dashboard → Account &amp; Settings → Website &amp; App settings → add{' '}
              <strong>{siteHost}</strong>
              {siteOrigin ? (
                <>
                  {' '}
                  (origin <code>{siteOrigin}</code>)
                </>
              ) : null}
              . If checkout opens but payment fails with a domain error, the whitelist is missing or
              still propagating.
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
