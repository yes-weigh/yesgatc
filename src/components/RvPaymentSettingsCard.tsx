import React, { useState } from 'react';
import { CreditCard, Wallet } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppSettings } from '../hooks/useAppSettings';
import { SegmentToggle } from './SegmentToggle';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
  type AppGlobalSettings,
} from '../lib/appSettings';

type RvPaymentMode = 'off' | 'wallet' | 'razorpay';

function modeFromSettings(settings: AppGlobalSettings): RvPaymentMode {
  if (settings.rvWalletEnabled) return 'wallet';
  if (settings.rvRazorpayEnabled) return 'razorpay';
  return 'off';
}

function paymentPatchFromMode(mode: RvPaymentMode): Pick<AppGlobalSettings, 'rvRazorpayEnabled' | 'rvWalletEnabled'> {
  return {
    rvRazorpayEnabled: mode === 'razorpay',
    rvWalletEnabled: mode === 'wallet',
  };
}

type RvPaymentSettingsCardProps = {
  className?: string;
};

export const RvPaymentSettingsCard: React.FC<RvPaymentSettingsCardProps> = ({ className = '' }) => {
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleModeChange = async (mode: RvPaymentMode) => {
    setSaving(true);
    setError('');
    try {
      const patch = paymentPatchFromMode(mode);
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
    <div className={`panel glass mt-6${className ? ` ${className}` : ''}`}>
      <div className="panel-header">
        <h2><CreditCard className="inline-icon" /> RV payment method</h2>
      </div>
      <div className="panel-body">
        <p className="text-muted text-sm mb-4">
          Choose how RC admins pay RV administrative fees before submit. Use <strong>Wallet</strong> while
          the Razorpay gateway is being set up — RC tops up via payment screenshots approved here.
        </p>

        {error && <p className="form-error mb-3">{error}</p>}

        {appSettingsLoading ? (
          <div className="text-center py-2"><span className="spinner-inline" /></div>
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <SegmentToggle
              ariaLabel="RV payment method"
              value={modeFromSettings(appSettings)}
              options={[
                { value: 'off', label: 'Off (no payment)', disabled: saving },
                { value: 'wallet', label: 'Wallet', disabled: saving },
                { value: 'razorpay', label: 'Razorpay', disabled: saving },
              ]}
              onChange={value => void handleModeChange(value as RvPaymentMode)}
              disabled={saving}
            />
            {saving && <span className="text-muted text-sm">Saving…</span>}
          </div>
        )}

        <p className="text-muted text-sm mt-4 mb-0 flex items-center gap-2">
          <Wallet size={14} aria-hidden />
          Manage pending wallet top-ups from the Wallet approvals page.
        </p>
      </div>
    </div>
  );
};

/** @deprecated Use RvPaymentSettingsCard */
export const RvRazorpaySettingsCard = RvPaymentSettingsCard;
