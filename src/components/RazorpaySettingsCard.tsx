import React, { useEffect, useState } from 'react';
import { CreditCard, Save } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
} from '../lib/appSettings';
import {
  DEFAULT_RAZORPAY_SETTINGS,
  razorpaySettingsFromForm,
  razorpaySettingsToFormValues,
  validateRazorpaySettingsForm,
  walletRechargeGrossInr,
  type RazorpaySettingsFormValues,
} from '../lib/razorpaySettings';

type RazorpaySettingsCardProps = {
  className?: string;
};

export const RazorpaySettingsCard: React.FC<RazorpaySettingsCardProps> = ({ className = '' }) => {
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [draft, setDraft] = useState<RazorpaySettingsFormValues>(
    razorpaySettingsToFormValues(DEFAULT_RAZORPAY_SETTINGS),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (appSettingsLoading) return;
    setDraft(razorpaySettingsToFormValues(appSettings));
  }, [appSettings, appSettingsLoading]);

  const updateDraft = (patch: Partial<RazorpaySettingsFormValues>) => {
    setSaved(false);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const previewWalletCredit = 1000;
  const previewPercent = Number(draft.razorpayServiceChargePercent);
  const previewGross = Number.isFinite(previewPercent)
    ? walletRechargeGrossInr(previewWalletCredit, previewPercent)
    : null;

  const handleSave = async () => {
    setError('');
    setSaved(false);
    const validationError = validateRazorpaySettingsForm(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const patch = razorpaySettingsFromForm(draft);
      await setDoc(
        doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
        {
          ...patch,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save Razorpay settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`panel glass mt-6${className ? ` ${className}` : ''}`}>
      <div className="panel-header">
        <h2>
          <CreditCard className="inline-icon" /> Razorpay settings
        </h2>
      </div>
      <div className="panel-body">
        {error && <p className="form-error mb-3">{error}</p>}
        {saved && <p className="text-success text-sm mb-3">Razorpay settings saved.</p>}

        {appSettingsLoading ? (
          <div className="text-center py-2"><span className="spinner-inline" /></div>
        ) : (
          <>
            <p className="text-muted text-sm mb-4">
              Wallet recharge via Razorpay credits the typed amount; the customer pays the service
              charge on top at checkout. PG fees are not posted to Zoho.
            </p>

            <fieldset className="admin-razorpay-recharge-mode mb-4">
              <legend className="text-sm font-semibold mb-2">Wallet recharge mode</legend>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="radio"
                  name="wallet-recharge-mode"
                  checked={draft.walletRechargeMode === 'manual'}
                  onChange={() => updateDraft({ walletRechargeMode: 'manual' })}
                  disabled={saving}
                />
                <span>Manual — screenshot upload and Super Admin approval</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="wallet-recharge-mode"
                  checked={draft.walletRechargeMode === 'razorpay'}
                  onChange={() => updateDraft({ walletRechargeMode: 'razorpay' })}
                  disabled={saving}
                />
                <span>Razorpay — instant credit via payment gateway</span>
              </label>
            </fieldset>

            <div className="form-grid admin-zoho-settings-grid">
              <div className="form-group">
                <label htmlFor="razorpay-service-charge">Service charge (%)</label>
                <input
                  id="razorpay-service-charge"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  className="input-field"
                  value={draft.razorpayServiceChargePercent}
                  onChange={e => updateDraft({ razorpayServiceChargePercent: e.target.value })}
                  disabled={saving}
                  placeholder={String(DEFAULT_RAZORPAY_SETTINGS.razorpayServiceChargePercent)}
                />
                <p className="text-muted text-xs mt-1 mb-0">
                  Added on top of wallet credit at payment (default 2%).
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="razorpay-min-recharge">Minimum wallet recharge (₹)</label>
                <input
                  id="razorpay-min-recharge"
                  type="number"
                  min={1}
                  step={1}
                  className="input-field"
                  value={draft.razorpayMinWalletRechargeInr}
                  onChange={e => updateDraft({ razorpayMinWalletRechargeInr: e.target.value })}
                  disabled={saving}
                  placeholder={String(DEFAULT_RAZORPAY_SETTINGS.razorpayMinWalletRechargeInr)}
                />
              </div>

              <div className="form-group admin-zoho-settings-grid__full">
                <label htmlFor="zoho-razorpay-account">Zoho Razorpay account ID</label>
                <input
                  id="zoho-razorpay-account"
                  className="input-field text-mono"
                  value={draft.zohoRazorpayAccountId}
                  onChange={e => updateDraft({ zohoRazorpayAccountId: e.target.value })}
                  disabled={saving}
                  placeholder={DEFAULT_RAZORPAY_SETTINGS.zohoRazorpayAccountId}
                />
                <p className="text-muted text-xs mt-1 mb-0">
                  GATC Wallet → this account on Razorpay wallet top-up approval.
                </p>
              </div>
            </div>

            {previewGross != null && previewGross > previewWalletCredit && (
              <p className="text-sm text-muted mt-3 mb-0">
                Example: ₹{previewWalletCredit.toLocaleString('en-IN')} wallet credit → customer pays
                {' '}
                <strong>₹{previewGross.toLocaleString('en-IN')}</strong>
                {' '}
                at Razorpay.
              </p>
            )}

            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                <Save size={16} aria-hidden />
                {saving ? 'Saving…' : 'Save Razorpay settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
