import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import {
  parseRcFeeAmountInput,
  rcFeesDraftFromUser,
  validateRcFeesStructure,
} from '../../lib/rcProfileFields';
import type { FirestoreUserDoc, RcFeeTierAmounts, RcFeesStructure } from '../../types';

function FeeInput({
  id,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
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
        value={value || ''}
        onChange={e => onChange(parseRcFeeAmountInput(e.target.value))}
        disabled={disabled}
        aria-label={ariaLabel}
      />
    </label>
  );
}

function TierCard({
  title,
  prefix,
  tier,
  disabled,
  onChange,
}: {
  title: string;
  prefix: string;
  tier: RcFeeTierAmounts;
  disabled: boolean;
  onChange: (field: keyof RcFeeTierAmounts, value: number) => void;
}) {
  return (
    <li className="rv-fees-card">
      <p className="admin-setting-fee-label">{title}</p>
      <div className="rv-fees-grid">
        <div>
          <span>Premises</span>
          <FeeInput
            id={`${prefix}-premise`}
            value={tier.inPremise}
            onChange={value => onChange('inPremise', value)}
            disabled={disabled}
            ariaLabel={`${title} — in the premises fee`}
          />
        </div>
        <div>
          <span>In situ</span>
          <FeeInput
            id={`${prefix}-situ`}
            value={tier.inSitu}
            onChange={value => onChange('inSitu', value)}
            disabled={disabled}
            ariaLabel={`${title} — in situ fee`}
          />
        </div>
        <div>
          <span>Self</span>
          <FeeInput
            id={`${prefix}-self`}
            value={tier.self}
            onChange={value => onChange('self', value)}
            disabled={disabled}
            ariaLabel={`${title} — self verification fee`}
          />
        </div>
      </div>
    </li>
  );
}

export function RvFeesPanel() {
  const { user } = useAuth();
  const [fees, setFees] = useState<RcFeesStructure>(rcFeesDraftFromUser(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;
        setFees(rcFeesDraftFromUser(snap.exists() ? (snap.data() as FirestoreUserDoc) : null));
      } catch {
        if (!cancelled) setError('Could not load RV fees.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const setTier =
    (tier: keyof RcFeesStructure) => (field: keyof RcFeeTierAmounts, value: number) => {
      setSaved(false);
      setFees(prev => ({
        ...prev,
        [tier]: { ...prev[tier], [field]: value },
      }));
    };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.uid || saving) return;
    setError('');
    setSaved(false);
    const invalid = validateRcFeesStructure(fees);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { feesStructure: fees });
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save RV fees.');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || loading;

  return (
    <div className="panel glass rv-fees-panel">
      <form onSubmit={event => void handleSave(event)}>
        {error ? <div className="login-error">{error}</div> : null}
        {saved ? <p className="text-muted text-sm mb-2">RV fees saved.</p> : null}
        <ul className="admin-setting-fee-list rv-fees-list">
          <TierCard
            title="Up to 20 kg"
            prefix="rv-fee-20"
            tier={fees.tierUpto20Kg}
            disabled={busy}
            onChange={setTier('tierUpto20Kg')}
          />
          <TierCard
            title="Above 20 kg"
            prefix="rv-fee-150"
            tier={fees.tierUpto150Kg}
            disabled={busy}
            onChange={setTier('tierUpto150Kg')}
          />
        </ul>
        <button
          type="submit"
          className="btn btn-primary rv-fees-save"
          disabled={busy}
        >
          {saving ? <span className="spinner-inline" /> : null}
          Save
        </button>
      </form>
    </div>
  );
}
