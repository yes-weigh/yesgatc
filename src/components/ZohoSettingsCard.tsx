import React, { useEffect, useState } from 'react';
import { FileText, Save } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
} from '../lib/appSettings';
import {
  DEFAULT_ZOHO_RV_SETTINGS,
  ZOHO_MODE_OF_TRANSPORT_OPTIONS,
  validateZohoRvSettingsForm,
  zohoRvSettingsFromForm,
  zohoRvSettingsToFormValues,
  type ZohoRvSettingsFormValues,
} from '../lib/zohoSettings';

type ZohoSettingsCardProps = {
  className?: string;
};

export const ZohoSettingsCard: React.FC<ZohoSettingsCardProps> = ({ className = '' }) => {
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [draft, setDraft] = useState<ZohoRvSettingsFormValues>(
    zohoRvSettingsToFormValues(DEFAULT_ZOHO_RV_SETTINGS),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (appSettingsLoading) return;
    setDraft(zohoRvSettingsToFormValues(appSettings));
  }, [appSettings, appSettingsLoading]);

  const updateDraft = (patch: Partial<ZohoRvSettingsFormValues>) => {
    setSaved(false);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    setError('');
    setSaved(false);
    const validationError = validateZohoRvSettingsForm(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const patch = zohoRvSettingsFromForm(draft);
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
      setError(err instanceof Error ? err.message : 'Failed to save Zoho settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`panel glass mt-6${className ? ` ${className}` : ''}`}>
      <div className="panel-header">
        <h2><FileText className="inline-icon" /> Zoho Books</h2>
      </div>
      <div className="panel-body">
        <p className="text-muted text-sm mb-4">
          Non-secret Zoho configuration for automatic RV invoices on submit. OAuth credentials stay in
          Cloud Functions secrets (<span className="text-mono">ZOHO_CLIENT_ID</span>,{' '}
          <span className="text-mono">ZOHO_CLIENT_SECRET</span>,{' '}
          <span className="text-mono">ZOHO_REFRESH_TOKEN</span>).
        </p>

        {error && <p className="form-error mb-3">{error}</p>}
        {saved && <p className="text-success text-sm mb-3">Zoho settings saved.</p>}

        {appSettingsLoading ? (
          <div className="text-center py-2"><span className="spinner-inline" /></div>
        ) : (
          <>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.zohoRvInvoicingEnabled}
                onChange={e => updateDraft({ zohoRvInvoicingEnabled: e.target.checked })}
                disabled={saving}
              />
              <span>Enable automatic Zoho invoice on RV submit</span>
            </label>

            <div className="form-grid admin-zoho-settings-grid">
              <div className="form-group">
                <label htmlFor="zoho-org-id">Organization ID</label>
                <input
                  id="zoho-org-id"
                  className="input-field text-mono"
                  value={draft.zohoOrganizationId}
                  onChange={e => updateDraft({ zohoOrganizationId: e.target.value })}
                  disabled={saving || !draft.zohoRvInvoicingEnabled}
                  placeholder={DEFAULT_ZOHO_RV_SETTINGS.zohoOrganizationId}
                />
              </div>

              <div className="form-group">
                <label htmlFor="zoho-salesperson-id">Salesperson ID</label>
                <input
                  id="zoho-salesperson-id"
                  className="input-field text-mono"
                  value={draft.zohoSalespersonId}
                  onChange={e => updateDraft({ zohoSalespersonId: e.target.value })}
                  disabled={saving || !draft.zohoRvInvoicingEnabled}
                  placeholder={DEFAULT_ZOHO_RV_SETTINGS.zohoSalespersonId}
                />
              </div>

              <div className="form-group">
                <label htmlFor="zoho-item-upto-20">Item ID — up to 20 kg (₹150)</label>
                <input
                  id="zoho-item-upto-20"
                  className="input-field text-mono"
                  value={draft.zohoItemIdUpto20Kg}
                  onChange={e => updateDraft({ zohoItemIdUpto20Kg: e.target.value })}
                  disabled={saving || !draft.zohoRvInvoicingEnabled}
                  placeholder={DEFAULT_ZOHO_RV_SETTINGS.zohoItemIdUpto20Kg}
                />
              </div>

              <div className="form-group">
                <label htmlFor="zoho-item-above-20">Item ID — above 20 kg (₹250)</label>
                <input
                  id="zoho-item-above-20"
                  className="input-field text-mono"
                  value={draft.zohoItemIdAbove20Kg}
                  onChange={e => updateDraft({ zohoItemIdAbove20Kg: e.target.value })}
                  disabled={saving || !draft.zohoRvInvoicingEnabled}
                  placeholder={DEFAULT_ZOHO_RV_SETTINGS.zohoItemIdAbove20Kg}
                />
              </div>

              <div className="form-group admin-zoho-settings-grid__full">
                <label htmlFor="zoho-mode-of-transport">Mode of transport (`cf_mode_of_transport`)</label>
                <select
                  id="zoho-mode-of-transport"
                  className="input-field"
                  value={draft.zohoModeOfTransport}
                  onChange={e => updateDraft({ zohoModeOfTransport: e.target.value })}
                  disabled={saving || !draft.zohoRvInvoicingEnabled}
                >
                  {ZOHO_MODE_OF_TRANSPORT_OPTIONS.map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="text-muted text-xs mt-1 mb-0">
                  Must match a Zoho Books dropdown label exactly. Use <strong>CUSTOMER PICKUP</strong> for
                  on-site RV without courier; <strong>With Machine</strong> when the RC travels with the machine.
                </p>
              </div>
            </div>

            <hr className="admin-zoho-settings-divider my-5" />

            <h3 className="text-base font-semibold mb-3">Wallet top-up transfer</h3>
            <p className="text-muted text-sm mb-4">
              When a Super Admin approves an RC wallet top-up, YesGATC records a{' '}
              <span className="text-mono">transfer_fund</span> in Zoho Books (GATC Wallet → Kotak).
              The description includes the RC name.
            </p>

            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.zohoWalletTransferEnabled}
                onChange={e => updateDraft({ zohoWalletTransferEnabled: e.target.checked })}
                disabled={saving}
              />
              <span>Enable Zoho transfer on wallet top-up approval</span>
            </label>

            <div className="form-grid admin-zoho-settings-grid">
              <div className="form-group">
                <label htmlFor="zoho-wallet-from">Source account ID (GATC Wallet)</label>
                <input
                  id="zoho-wallet-from"
                  className="input-field text-mono"
                  value={draft.zohoWalletFromAccountId}
                  onChange={e => updateDraft({ zohoWalletFromAccountId: e.target.value })}
                  disabled={saving || !draft.zohoWalletTransferEnabled}
                  placeholder={DEFAULT_ZOHO_RV_SETTINGS.zohoWalletFromAccountId}
                />
              </div>

              <div className="form-group">
                <label htmlFor="zoho-wallet-to">Destination account ID (Kotak)</label>
                <input
                  id="zoho-wallet-to"
                  className="input-field text-mono"
                  value={draft.zohoWalletToAccountId}
                  onChange={e => updateDraft({ zohoWalletToAccountId: e.target.value })}
                  disabled={saving || !draft.zohoWalletTransferEnabled}
                  placeholder={DEFAULT_ZOHO_RV_SETTINGS.zohoWalletToAccountId}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                <Save size={16} aria-hidden />
                {saving ? 'Saving…' : 'Save Zoho settings'}
              </button>
              <p className="text-muted text-sm mb-0">
                RV submit creates one B2C invoice. Wallet approval moves funds GATC Wallet → Kotak in Books.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
