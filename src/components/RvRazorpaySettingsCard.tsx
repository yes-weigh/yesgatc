import React, { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppSettings } from '../hooks/useAppSettings';
import { SegmentToggle } from './SegmentToggle';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
  type AppGlobalSettings,
} from '../lib/appSettings';

export const RvRazorpaySettingsCard: React.FC = () => {
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleToggle = async (enabled: boolean) => {
    setSaving(true);
    setError('');
    try {
      const patch: AppGlobalSettings = { rvRazorpayEnabled: enabled };
      await setDoc(
        doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
        {
          ...patch,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update payment setting.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel glass mt-6">
      <div className="panel-header">
        <h2><CreditCard className="inline-icon" /> RV Razorpay</h2>
      </div>
      <div className="panel-body">
        <p className="text-muted text-sm mb-4">
          Global switch for RV payment before submit. Turn off while Razorpay domains are being
          whitelisted — users will see <strong>Submit for certification</strong> without payment.
        </p>

        {error && <p className="form-error mb-3">{error}</p>}

        {appSettingsLoading ? (
          <div className="text-center py-2"><span className="spinner-inline" /></div>
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <SegmentToggle
              ariaLabel="RV Razorpay payment"
              value={appSettings.rvRazorpayEnabled ? 'on' : 'off'}
              options={[
                { value: 'off', label: 'Off (submit without pay)', disabled: saving },
                { value: 'on', label: 'On (pay before submit)', disabled: saving },
              ]}
              onChange={value => void handleToggle(value === 'on')}
              disabled={saving}
            />
            {saving && <span className="text-muted text-sm">Saving…</span>}
          </div>
        )}
      </div>
    </div>
  );
};
