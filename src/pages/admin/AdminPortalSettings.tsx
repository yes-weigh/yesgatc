import React, { useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { CreditCard, Eye, EyeOff, IndianRupee, Lock, Save, Scale, UserCircle } from 'lucide-react';
import { auth, db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { authEmailForAadhar, formatAadharDisplay } from '../../lib/aadharAuth';
import { APP_VERSION } from '../../lib/appVersion';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
} from '../../lib/appSettings';
import {
  formatRcFeeAmount,
  parseRcFeeAmountInput,
  verificationFeeWithGst,
} from '../../lib/rcProfileFields';
import {
  DEFAULT_ZOHO_RV_SETTINGS,
  normalizeZohoFeeAmountInr,
  normalizeZohoTdsPercent,
  zohoTdsAmountInr,
} from '../../lib/zohoSettings';
import { ROLE_LABELS } from '../../types';
import { ContractorFeePanel } from '../shared/ContractorFeeSettings';
import { WebbookPanel } from './WebbookPanel';
import { YesoneInboundPanel } from './YesoneInboundPanel';

type SettingTab = 'account' | 'fees' | 'contractor' | 'webbook' | 'yesone';

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
}) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-icon-wrap">
        <Lock size={18} className="input-icon" />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className="input-field input-with-icon"
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="input-icon-right"
          onClick={onToggle}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}

function formatFeeMoney(amount: number): string {
  if (Number.isInteger(amount)) return formatRcFeeAmount(amount);
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sanitizeTdsPercentInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot < 0) return cleaned.slice(0, 3);
  return `${cleaned.slice(0, dot).slice(0, 3)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`;
}

function FeeAmountField({
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

function FeePercentField({
  id,
  value,
  onChange,
  disabled,
  tdsAmount,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  tdsAmount: number;
}) {
  return (
    <div className="admin-setting-fee-percent-wrap">
      <label className="admin-setting-fee-amount admin-setting-fee-percent" htmlFor={id}>
        <input
          id={id}
          className="input-field text-mono"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(sanitizeTdsPercentInput(e.target.value))}
          disabled={disabled}
          aria-label="TDS percent"
        />
        <span className="admin-setting-fee-currency" aria-hidden>
          %
        </span>
      </label>
      <p className="admin-setting-fee-col-hint mb-0">TDS {formatFeeMoney(tdsAmount)}</p>
    </div>
  );
}

function FeeRow({
  label,
  amountId,
  amount,
  onAmountChange,
  tdsPercentId,
  tdsPercent,
  onTdsPercentChange,
  disabled,
}: {
  label: string;
  amountId: string;
  amount: string;
  onAmountChange: (value: string) => void;
  tdsPercentId: string;
  tdsPercent: string;
  onTdsPercentChange: (value: string) => void;
  disabled: boolean;
}) {
  const base = parseRcFeeAmountInput(amount);
  const percent = normalizeZohoTdsPercent(tdsPercent, -1);
  const gst = base > 0 ? verificationFeeWithGst(base).gst : 0;
  const tdsInr = percent >= 0 ? zohoTdsAmountInr(base, percent) : 0;
  const walletDeduction = gst + tdsInr;
  return (
    <li className="admin-setting-fee-row">
      <p className="admin-setting-fee-label">{label}</p>
      <FeeAmountField
        id={amountId}
        value={amount}
        onChange={onAmountChange}
        disabled={disabled}
        ariaLabel={`${label} amount`}
      />
      <p className="admin-setting-fee-gst">
        <span className="admin-setting-fee-col-hint">GST 18%</span>
        {formatFeeMoney(gst)}
      </p>
      <FeePercentField
        id={tdsPercentId}
        value={tdsPercent}
        onChange={onTdsPercentChange}
        disabled={disabled}
        tdsAmount={tdsInr}
      />
      <p className="admin-setting-fee-total">
        <span className="admin-setting-fee-col-hint">GATC wallet</span>
        {formatFeeMoney(walletDeduction)}
      </p>
    </li>
  );
}

export const AdminPortalSettings: React.FC = () => {
  const { user } = useAuth();
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [tab, setTab] = useState<SettingTab>('account');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [upto20, setUpto20] = useState(String(DEFAULT_ZOHO_RV_SETTINGS.zohoFeeUpto20KgInr));
  const [above20, setAbove20] = useState(String(DEFAULT_ZOHO_RV_SETTINGS.zohoFeeAbove20KgInr));
  const [tdsPercent, setTdsPercent] = useState(String(DEFAULT_ZOHO_RV_SETTINGS.zohoTdsPercent));
  const [savingFees, setSavingFees] = useState(false);
  const [feesError, setFeesError] = useState('');
  const [feesSaved, setFeesSaved] = useState(false);

  useEffect(() => {
    if (appSettingsLoading) return;
    setUpto20(String(appSettings.zohoFeeUpto20KgInr));
    setAbove20(String(appSettings.zohoFeeAbove20KgInr));
    setTdsPercent(String(appSettings.zohoTdsPercent));
  }, [appSettings, appSettingsLoading]);

  if (!user) return null;

  const handlePasswordSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setPasswordError('Not signed in.');
      return;
    }

    setSavingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(
        authEmailForAadhar(user.aadhar),
        currentPassword,
      );
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);
      await updateDoc(doc(db, 'users', user.uid), {
        clearTextPassword: newPassword,
        updatedAt: new Date().toISOString(),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : '';
      if (
        raw.includes('invalid-credential') ||
        raw.includes('wrong-password') ||
        raw.includes('user-not-found')
      ) {
        setPasswordError('Current password is incorrect.');
      } else {
        setPasswordError(raw || 'Failed to update password.');
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const handleFeesSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeesError('');
    setFeesSaved(false);
    const upto = normalizeZohoFeeAmountInr(upto20, 0);
    const above = normalizeZohoFeeAmountInr(above20, 0);
    const percent = normalizeZohoTdsPercent(tdsPercent, -1);
    if (upto < 1) {
      setFeesError('Upto 20 kg amount must be 1 or more.');
      return;
    }
    if (above < 1) {
      setFeesError('Above 20 kg amount must be 1 or more.');
      return;
    }
    if (percent < 0 || percent > 100) {
      setFeesError('TDS percent must be 0 to 100.');
      return;
    }

    const tdsUpto = zohoTdsAmountInr(upto, percent);
    const tdsAbove = zohoTdsAmountInr(above, percent);

    setSavingFees(true);
    try {
      await setDoc(
        doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
        {
          zohoFeeUpto20KgInr: upto,
          zohoFeeAbove20KgInr: above,
          zohoTdsPercent: percent,
          zohoTdsUpto20KgInr: tdsUpto,
          zohoTdsAbove20KgInr: tdsAbove,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      setUpto20(String(upto));
      setAbove20(String(above));
      setTdsPercent(String(percent));
      setFeesSaved(true);
    } catch (err: unknown) {
      setFeesError(err instanceof Error ? err.message : 'Failed to save fees.');
    } finally {
      setSavingFees(false);
    }
  };

  return (
    <div className={`fade-in page-content admin-setting-page admin-setting-page--six-tabs${tab === 'yesone' ? ' admin-setting-page--wide' : ''}`}>
      <div className="admin-setting-bar">
        <div className="admin-setting-tabs" role="tablist" aria-label="Setting">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'account'}
            className={`admin-setting-tab${tab === 'account' ? ' admin-setting-tab--active' : ''}`}
            onClick={() => setTab('account')}
          >
            Account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'fees'}
            className={`admin-setting-tab${tab === 'fees' ? ' admin-setting-tab--active' : ''}`}
            onClick={() => setTab('fees')}
          >
            Fees
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'contractor'}
            className={`admin-setting-tab${tab === 'contractor' ? ' admin-setting-tab--active' : ''}`}
            onClick={() => setTab('contractor')}
          >
            Contractor fees
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'webbook'}
            className={`admin-setting-tab${tab === 'webbook' ? ' admin-setting-tab--active' : ''}`}
            onClick={() => setTab('webbook')}
          >
            Webbook
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'yesone'}
            className={`admin-setting-tab${tab === 'yesone' ? ' admin-setting-tab--active' : ''}`}
            onClick={() => setTab('yesone')}
          >
            Yesone
          </button>
        </div>
      </div>

      {tab === 'account' ? (
        <>
          <div className="panel glass">
            <div className="panel-header">
              <h2>
                <UserCircle className="inline-icon" aria-hidden />
                Account
              </h2>
            </div>
            <div className="profile-field">
              <div className="profile-field-label">
                <span className="profile-icon" aria-hidden>
                  <UserCircle size={14} />
                </span>
                <span>Name</span>
              </div>
              <p className="profile-value">{user.username || '—'}</p>
            </div>
            <div className="profile-field">
              <div className="profile-field-label">
                <span className="profile-icon" aria-hidden>
                  <CreditCard size={14} />
                </span>
                <span>Aadhar</span>
              </div>
              <p className="profile-value text-mono">{formatAadharDisplay(user.aadhar)}</p>
            </div>
            <div className="profile-field">
              <div className="profile-field-label">
                <span>Role</span>
              </div>
              <p className="profile-value">{ROLE_LABELS[user.role]}</p>
            </div>
            <div className="profile-field">
              <div className="profile-field-label">
                <span>App version</span>
              </div>
              <p className="profile-value">{APP_VERSION}</p>
            </div>
          </div>

          <div className="panel glass">
            <div className="panel-header">
              <h2>
                <Lock className="inline-icon" aria-hidden />
                Password
              </h2>
            </div>
            <form onSubmit={event => void handlePasswordSave(event)}>
              {passwordError ? <div className="login-error">{passwordError}</div> : null}
              {passwordSaved ? <p className="text-muted text-sm">Password updated.</p> : null}
              <PasswordField
                id="setting-current-password"
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                show={showCurrent}
                onToggle={() => setShowCurrent(value => !value)}
                autoComplete="current-password"
              />
              <PasswordField
                id="setting-new-password"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                show={showNew}
                onToggle={() => setShowNew(value => !value)}
                autoComplete="new-password"
              />
              <PasswordField
                id="setting-confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                show={showNew}
                onToggle={() => setShowNew(value => !value)}
                autoComplete="new-password"
              />
              <button
                type="submit"
                className="btn btn-primary flex items-center gap-2"
                disabled={savingPassword}
              >
                {savingPassword ? <span className="spinner-inline" /> : <Save size={16} aria-hidden />}
                Save password
              </button>
            </form>
          </div>
        </>
      ) : tab === 'fees' ? (
        <div className="panel glass">
          <div className="panel-header">
            <h2>
              <IndianRupee className="inline-icon" aria-hidden />
              Fees
            </h2>
          </div>
          <p className="text-muted text-sm mb-4">
            GST 18% is fixed. Enter TDS %. Wallet deduction = GST + TDS.
          </p>
          <form onSubmit={event => void handleFeesSave(event)}>
            {feesError ? <div className="login-error">{feesError}</div> : null}
            {feesSaved ? <p className="text-muted text-sm">Fees saved.</p> : null}
            <div className="admin-setting-fee-table">
            <div className="admin-setting-fee-head" aria-hidden>
              <span>Capacity</span>
              <span>Amount</span>
              <span>GST</span>
              <span>TDS %</span>
              <span>GATC wallet</span>
            </div>
            <ul className="admin-setting-fee-list">
              <FeeRow
                label="Upto 20 kg"
                amountId="setting-fee-upto-20"
                amount={upto20}
                onAmountChange={value => {
                  setFeesSaved(false);
                  setUpto20(value);
                }}
                tdsPercentId="setting-tds-percent-upto-20"
                tdsPercent={tdsPercent}
                onTdsPercentChange={value => {
                  setFeesSaved(false);
                  setTdsPercent(value);
                }}
                disabled={savingFees || appSettingsLoading}
              />
              <FeeRow
                label="Above 20 kg"
                amountId="setting-fee-above-20"
                amount={above20}
                onAmountChange={value => {
                  setFeesSaved(false);
                  setAbove20(value);
                }}
                tdsPercentId="setting-tds-percent-above-20"
                tdsPercent={tdsPercent}
                onTdsPercentChange={value => {
                  setFeesSaved(false);
                  setTdsPercent(value);
                }}
                disabled={savingFees || appSettingsLoading}
              />
            </ul>
            </div>
            <button
              type="submit"
              className="btn btn-primary flex items-center gap-2 mt-4"
              disabled={savingFees || appSettingsLoading}
            >
              {savingFees ? <span className="spinner-inline" /> : <Scale size={16} aria-hidden />}
              Save fees
            </button>
          </form>
        </div>
      ) : tab === 'contractor' ? (
        <ContractorFeePanel />
      ) : tab === 'webbook' ? (
        <WebbookPanel />
      ) : (
        <YesoneInboundPanel />
      )}
    </div>
  );
};
