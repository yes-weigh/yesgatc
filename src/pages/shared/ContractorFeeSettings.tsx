import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { HardHat, Settings } from 'lucide-react';
import { db } from '../../firebase';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
} from '../../lib/appSettings';
import {
  CONTRACTOR_FEE_DEFAULT,
  CONTRACTOR_FEE_LEGACY,
  contractorFeeForForm,
  contractorFeeSchedulesAfterSave,
  formatContractorFeeEffectiveLabel,
  localDateKey,
  normalizeContractorFeeAmountInr,
  normalizeContractorFeeZeroAmountInr,
} from '../../lib/contractorFeeSettings';
import { formatRcFeeAmount } from '../../lib/rcProfileFields';

function formatFeeMoney(amount: number): string {
  if (Number.isInteger(amount)) return formatRcFeeAmount(amount);
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function AmountField({
  id,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <label className="admin-setting-fee-amount" htmlFor={id}>
      <span className="admin-setting-fee-currency" aria-hidden>
        ₹
      </span>
      <input
        id={id}
        className="input-field text-mono"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={disabled}
        aria-label={ariaLabel}
      />
    </label>
  );
}

export function ContractorFeePanel() {
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [upto20, setUpto20] = useState(String(CONTRACTOR_FEE_DEFAULT.upto20Kg));
  const [above20, setAbove20] = useState(String(CONTRACTOR_FEE_DEFAULT.above20Kg));
  const [handling, setHandling] = useState(String(CONTRACTOR_FEE_DEFAULT.handlingFee));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (appSettingsLoading) return;
    const live = contractorFeeForForm(appSettings.contractorFeeSchedules);
    setUpto20(String(live.upto20Kg));
    setAbove20(String(live.above20Kg));
    setHandling(String(live.handlingFee));
  }, [appSettings, appSettingsLoading]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    const upto = normalizeContractorFeeAmountInr(upto20, 0);
    const above = normalizeContractorFeeAmountInr(above20, 0);
    const handlingFee = normalizeContractorFeeZeroAmountInr(handling, 0);
    if (upto < 1) {
      setError('Upto 20 kg amount must be 1 or more.');
      return;
    }
    if (above < 1) {
      setError('Above 20 kg amount must be 1 or more.');
      return;
    }

    const schedules = contractorFeeSchedulesAfterSave(appSettings.contractorFeeSchedules, {
      upto20Kg: upto,
      above20Kg: above,
      handlingFee,
    });

    setSaving(true);
    try {
      await setDoc(
        doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
        {
          contractorFeeSchedules: schedules,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      setUpto20(String(upto));
      setAbove20(String(above));
      setHandling(String(handlingFee));
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save contractor fee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel glass">
      <div className="panel-header">
        <h2>
          <HardHat className="inline-icon" aria-hidden />
          RC contractor fee
        </h2>
      </div>
      <p className="text-muted text-sm mb-4">
        RC pays contractor. Handling fee stays ₹0 until you set it. Save applies from today.
        Past report days keep old rates. Handling shows on report only when greater than zero.
      </p>
      <form onSubmit={event => void handleSave(event)}>
        {error ? <div className="login-error">{error}</div> : null}
        {saved ? (
          <p className="text-muted text-sm">
            Contractor fee saved from {formatContractorFeeEffectiveLabel(localDateKey())}.
          </p>
        ) : null}
        <div className="admin-setting-contractor-table">
          <div className="admin-setting-contractor-head" aria-hidden>
            <span>Capacity</span>
            <span>Amount</span>
          </div>
          <ul className="admin-setting-fee-list">
            <li className="admin-setting-contractor-row">
              <p className="admin-setting-fee-label">Upto 20 kg</p>
              <AmountField
                id="setting-contractor-upto-20"
                value={upto20}
                onChange={value => {
                  setSaved(false);
                  setUpto20(value);
                }}
                disabled={saving || appSettingsLoading}
                ariaLabel="Upto 20 kg contractor fee"
              />
            </li>
            <li className="admin-setting-contractor-row">
              <p className="admin-setting-fee-label">Above 20 kg</p>
              <AmountField
                id="setting-contractor-above-20"
                value={above20}
                onChange={value => {
                  setSaved(false);
                  setAbove20(value);
                }}
                disabled={saving || appSettingsLoading}
                ariaLabel="Above 20 kg contractor fee"
              />
            </li>
            <li className="admin-setting-contractor-row">
              <p className="admin-setting-fee-label">Handling fee</p>
              <AmountField
                id="setting-contractor-handling"
                value={handling}
                onChange={value => {
                  setSaved(false);
                  setHandling(value);
                }}
                disabled={saving || appSettingsLoading}
                ariaLabel="Handling fee"
              />
            </li>
          </ul>
        </div>
        <button
          type="submit"
          className="btn btn-primary flex items-center gap-2 mt-4"
          disabled={saving || appSettingsLoading}
        >
          {saving ? <span className="spinner-inline" /> : <HardHat size={16} aria-hidden />}
          Save contractor fee
        </button>
      </form>
      {appSettings.contractorFeeSchedules.length === 0 ? (
        <p className="text-muted text-sm mt-4 mb-0">
          Reports still use {formatFeeMoney(CONTRACTOR_FEE_LEGACY.upto20Kg)} /{' '}
          {formatFeeMoney(CONTRACTOR_FEE_LEGACY.above20Kg)} until save.
        </p>
      ) : (
        <ol className="admin-setting-contractor-history">
          {[...appSettings.contractorFeeSchedules].reverse().map(row => (
            <li key={row.effectiveFrom}>
              <span>{formatContractorFeeEffectiveLabel(row.effectiveFrom)}</span>
              <span className="text-mono">
                {formatFeeMoney(row.upto20Kg)} / {formatFeeMoney(row.above20Kg)}
                {row.handlingFee > 0 ? ` · H ${formatFeeMoney(row.handlingFee)}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export const ContractorFeeSettings: React.FC = () => {
  return (
    <div className="fade-in page-content admin-setting-page">
      <header className="admin-setting-header">
        <h1 className="admin-setting-title">
          <Settings className="inline-icon" aria-hidden />
          Setting
        </h1>
        <p className="admin-setting-subtitle text-muted text-sm mb-0">
          RC contractor fee. Upto 20 kg ₹150. Above 20 kg ₹250. Handling fee ₹0.
        </p>
      </header>
      <ContractorFeePanel />
    </div>
  );
};
