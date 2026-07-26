import React, { useState } from 'react';
import { MapPin } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
} from '../lib/appSettings';
import {
  INTERWEIGH_OV_PARTY,
  OV_INTERWEIGH_ONLY_HINT,
  OV_INTERWEIGH_ONLY_LABEL,
  isOvInterweighOnlyEnabled,
} from '../lib/interweighOvMode';

type OvInterweighOnlySwitchProps = {
  className?: string;
};

export const OvInterweighOnlySwitch: React.FC<OvInterweighOnlySwitchProps> = ({
  className = '',
}) => {
  const { user } = useAuth();
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const enabled = isOvInterweighOnlyEnabled(appSettings);
  const canEdit = user?.role === 'super_admin';

  const handleToggle = async () => {
    if (!canEdit || saving || appSettingsLoading) return;
    setError('');
    setSaving(true);
    try {
      await setDoc(
        doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
        {
          ovInterweighOnlyEnabled: !enabled,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update setting.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={`ov-interweigh-switch${className ? ` ${className}` : ''}${
        enabled ? ' ov-interweigh-switch--on' : ''
      }`}
      aria-label={OV_INTERWEIGH_ONLY_LABEL}
    >
      <div className="ov-interweigh-switch__top">
        <div className="ov-interweigh-switch__copy">
          <p className="ov-interweigh-switch__label">{OV_INTERWEIGH_ONLY_LABEL}</p>
          <p className="ov-interweigh-switch__hint">{OV_INTERWEIGH_ONLY_HINT}</p>
        </div>
        <label className="ov-interweigh-switch__control">
          <span className="sr-only">{OV_INTERWEIGH_ONLY_LABEL}</span>
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={() => void handleToggle()}
            disabled={!canEdit || saving || appSettingsLoading}
            aria-checked={enabled}
          />
          <span className="ov-interweigh-switch__track" aria-hidden>
            <span className="ov-interweigh-switch__thumb" />
          </span>
        </label>
      </div>

      <div className="ov-interweigh-switch__address">
        <MapPin size={14} aria-hidden />
        <div>
          <p className="ov-interweigh-switch__party">{INTERWEIGH_OV_PARTY.name}</p>
          <p className="ov-interweigh-switch__lines">
            {INTERWEIGH_OV_PARTY.address}
            <br />
            PIN {INTERWEIGH_OV_PARTY.pincode} · {INTERWEIGH_OV_PARTY.district},{' '}
            {INTERWEIGH_OV_PARTY.state}
            <br />
            {INTERWEIGH_OV_PARTY.phone}
          </p>
        </div>
      </div>

      {error ? <p className="form-error mb-0 mt-2">{error}</p> : null}
      {!canEdit ? (
        <p className="ov-interweigh-switch__readonly text-muted">
          Only Super Admin can change this mode.
        </p>
      ) : null}
    </section>
  );
};
