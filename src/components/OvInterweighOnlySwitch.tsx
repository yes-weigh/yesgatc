import React, { useEffect, useState } from 'react';
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
  getOvInterweighGpsCoords,
  isOvInterweighOnlyEnabled,
} from '../lib/interweighOvMode';

type OvInterweighOnlySwitchProps = {
  className?: string;
};

function parseCoordInput(raw: string, kind: 'lat' | 'lng'): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (kind === 'lat' && (value < -90 || value > 90)) return null;
  if (kind === 'lng' && (value < -180 || value > 180)) return null;
  return value;
}

export const OvInterweighOnlySwitch: React.FC<OvInterweighOnlySwitchProps> = ({
  className = '',
}) => {
  const { user } = useAuth();
  const { appSettings, appSettingsLoading } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [savingGps, setSavingGps] = useState(false);
  const [error, setError] = useState('');
  const [gpsSaved, setGpsSaved] = useState(false);
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const enabled = isOvInterweighOnlyEnabled(appSettings);
  const savedCoords = getOvInterweighGpsCoords(appSettings);
  const canEdit = user?.role === 'super_admin';

  useEffect(() => {
    setLatInput(
      appSettings.ovInterweighLatitude == null
        ? ''
        : String(appSettings.ovInterweighLatitude),
    );
    setLngInput(
      appSettings.ovInterweighLongitude == null
        ? ''
        : String(appSettings.ovInterweighLongitude),
    );
  }, [appSettings.ovInterweighLatitude, appSettings.ovInterweighLongitude]);

  const handleToggle = async () => {
    if (!canEdit || saving || appSettingsLoading) return;
    setError('');
    setGpsSaved(false);
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

  const handleSaveGps = async () => {
    if (!canEdit || savingGps || appSettingsLoading) return;
    setError('');
    setGpsSaved(false);

    const latRaw = latInput.trim();
    const lngRaw = lngInput.trim();
    if ((latRaw && !lngRaw) || (!latRaw && lngRaw)) {
      setError('Enter both latitude and longitude, or clear both.');
      return;
    }

    const lat = latRaw ? parseCoordInput(latRaw, 'lat') : null;
    const lng = lngRaw ? parseCoordInput(lngRaw, 'lng') : null;
    if (latRaw && lat == null) {
      setError('Latitude must be a number between -90 and 90.');
      return;
    }
    if (lngRaw && lng == null) {
      setError('Longitude must be a number between -180 and 180.');
      return;
    }

    setSavingGps(true);
    try {
      await setDoc(
        doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
        {
          ovInterweighLatitude: lat,
          ovInterweighLongitude: lng,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      setGpsSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save GPS.');
    } finally {
      setSavingGps(false);
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

      <div className="ov-interweigh-switch__gps">
        <p className="ov-interweigh-switch__gps-label">Fixed GPS for photo stamps</p>
        <p className="ov-interweigh-switch__hint">
          When the switch is on, verification photos use this location instead of RC centre /
          device GPS.
        </p>
        <div className="ov-interweigh-switch__gps-grid">
          <label className="ov-interweigh-switch__gps-field">
            <span>Latitude</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 9.9670"
              value={latInput}
              onChange={e => {
                setLatInput(e.target.value);
                setGpsSaved(false);
              }}
              disabled={!canEdit || savingGps || appSettingsLoading}
              autoComplete="off"
            />
          </label>
          <label className="ov-interweigh-switch__gps-field">
            <span>Longitude</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 76.3180"
              value={lngInput}
              onChange={e => {
                setLngInput(e.target.value);
                setGpsSaved(false);
              }}
              disabled={!canEdit || savingGps || appSettingsLoading}
              autoComplete="off"
            />
          </label>
        </div>
        {savedCoords ? (
          <p className="ov-interweigh-switch__gps-current">
            Saved: {savedCoords.lat}, {savedCoords.lng}
          </p>
        ) : (
          <p className="ov-interweigh-switch__gps-current text-muted">
            No GPS saved yet.
          </p>
        )}
        {canEdit ? (
          <button
            type="button"
            className="btn btn-secondary ov-interweigh-switch__gps-save"
            onClick={() => void handleSaveGps()}
            disabled={savingGps || appSettingsLoading}
          >
            {savingGps ? 'Saving…' : 'Save GPS'}
          </button>
        ) : null}
        {gpsSaved ? (
          <p className="ov-interweigh-switch__gps-saved">GPS saved.</p>
        ) : null}
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
