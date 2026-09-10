import React, { useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { normalizePhone } from '../../lib/contactFields';
import { useAuth } from '../../context/AuthContext';
import { UploadField } from '../admin/productFormUi';
import type { ImageUploadState } from './CustomerFormFields';
import { PartyInformationForm } from '../../components/PartyInformationForm';
import {
  EMPTY_VERIFIER_LOCATION,
  VERIFIER_GPS_REQUIRED_MESSAGE,
  parseVerifierLatLng,
  verifierPartyFormValues,
  type VerifierLocationValues,
} from '../../lib/verifierProfileFields';
import { ovInNameToggleLabels, type VerifierOvInName } from '../../lib/verifierOvInName';
import type { CustomerFormValues } from '../../lib/customerProfileFields';

export type VerifierFormValues = {
  username: string;
  aadhar: string;
  phone: string;
  email: string;
  password: string;
  ovInName: VerifierOvInName | '';
} & VerifierLocationValues;

export const EMPTY_VERIFIER_FORM: VerifierFormValues = {
  username: '',
  aadhar: '',
  phone: '',
  email: '',
  password: '',
  ovInName: '',
  ...EMPTY_VERIFIER_LOCATION,
};

type VerifierFormFieldsProps = {
  mode: 'create' | 'edit';
  values: VerifierFormValues;
  onChange: (patch: Partial<VerifierFormValues>) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  loginAadhar?: string;
  profilePhoto: ImageUploadState;
  onProfilePhotoSelect: (file: File) => void;
  onProfilePhotoRemove: () => void;
  submitting: boolean;
  /** RC display name for OV-in-name toggle line 2 (`companyName` || `username`). */
  rcDisplayName?: string;
};

const LOCATION_KEYS: Array<keyof VerifierLocationValues> = [
  'address',
  'pincode',
  'state',
  'district',
  'latitude',
  'longitude',
];

function locationPatchFromParty(patch: Partial<CustomerFormValues>): Partial<VerifierLocationValues> {
  const next: Partial<VerifierLocationValues> = {};
  for (const key of LOCATION_KEYS) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}

export const VerifierFormFields: React.FC<VerifierFormFieldsProps> = ({
  mode,
  values,
  onChange,
  showPassword,
  onTogglePassword,
  loginAadhar,
  profilePhoto,
  onProfilePhotoSelect,
  onProfilePhotoRemove,
  submitting,
  rcDisplayName = '',
}) => {
  const { user } = useAuth();
  const identityLocked = user?.role === 'verifier';
  const fieldsLocked = submitting || identityLocked;
  const profilePhotoRef = useRef<HTMLInputElement>(null);
  const gpsMissing = !parseVerifierLatLng(values);
  const ovNameLabels = ovInNameToggleLabels(values.username, rcDisplayName);
  const ovSwitchState =
    values.ovInName === 'verifier' ? ' is-verifier' : values.ovInName === 'rc' ? ' is-rc' : '';

  return (
    <div className="form-grid verifier-form-grid">
      <div className="form-group verifier-field--ov-in-name">
        <span className="verifier-ov-in-name-label" id="verifier-ov-in-name-label">
          OV certificate name
        </span>
        <div
          className={`verifier-ov-in-name${ovSwitchState}`}
          role="radiogroup"
          aria-labelledby="verifier-ov-in-name-label"
        >
          <button
            type="button"
            className={`verifier-ov-in-name-opt${values.ovInName === 'verifier' ? ' is-active' : ''}`}
            role="radio"
            aria-checked={values.ovInName === 'verifier'}
            aria-label={`OV in ${ovNameLabels.verifier}`}
            disabled={fieldsLocked}
            onClick={() => onChange({ ovInName: 'verifier' })}
          >
            <span className="verifier-ov-in-name-kicker">OV in</span>
            <span className="verifier-ov-in-name-party">{ovNameLabels.verifier}</span>
          </button>
          <button
            type="button"
            className={`verifier-ov-in-name-opt${values.ovInName === 'rc' ? ' is-active' : ''}`}
            role="radio"
            aria-checked={values.ovInName === 'rc'}
            aria-label={`OV in ${ovNameLabels.rc}`}
            disabled={fieldsLocked}
            onClick={() => onChange({ ovInName: 'rc' })}
          >
            <span className="verifier-ov-in-name-kicker">OV in</span>
            <span className="verifier-ov-in-name-party">{ovNameLabels.rc}</span>
          </button>
        </div>
      </div>
      <div className="form-group verifier-field--name">
        <label htmlFor="verifier-name">Full name</label>
        <input
          id="verifier-name"
          className="input-field"
          value={values.username}
          onChange={e => onChange({ username: e.target.value })}
          autoComplete="off"
          required
          disabled={fieldsLocked}
        />
      </div>
      <div className="form-group verifier-field--phone">
        <label htmlFor="verifier-phone">Primary phone</label>
        <input
          id="verifier-phone"
          className="input-field"
          inputMode="numeric"
          value={values.phone}
          onChange={e => onChange({ phone: normalizePhone(e.target.value) })}
          autoComplete="off"
          required
          disabled={fieldsLocked}
        />
      </div>
      <div className="form-group verifier-field--aadhar">
        <label htmlFor="verifier-aadhar">Login Aadhar (not phone)</label>
        <input
          id="verifier-aadhar"
          className="input-field"
          inputMode="numeric"
          value={mode === 'edit' ? formatAadharDisplay(loginAadhar || values.aadhar) : values.aadhar}
          onChange={e => onChange({ aadhar: e.target.value.replace(/\D/g, '').slice(0, 12) })}
          disabled={mode === 'edit' || fieldsLocked}
          autoComplete="off"
          required={mode === 'create'}
        />
      </div>
      <div className="form-group verifier-field--email">
        <label htmlFor="verifier-email">Contact email</label>
        <input
          id="verifier-email"
          className="input-field"
          type="email"
          value={values.email}
          onChange={e => onChange({ email: e.target.value })}
          autoComplete="off"
          disabled={fieldsLocked}
        />
      </div>
      <div className="form-group verifier-field--password">
        <label htmlFor="verifier-password">
          {mode === 'create' ? 'Password' : 'New password (optional)'}
        </label>
        <div className="input-icon-wrap">
          <input
            id="verifier-password"
            className="input-field"
            type={showPassword ? 'text' : 'password'}
            value={values.password}
            onChange={e => onChange({ password: e.target.value })}
            autoComplete="new-password"
            required={mode === 'create'}
            minLength={mode === 'create' ? 6 : undefined}
            disabled={fieldsLocked}
          />
          <button
            type="button"
            className="input-icon-btn"
            onClick={onTogglePassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            disabled={fieldsLocked}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div className="form-group verifier-field--photo">
        <UploadField
          label="Photo (optional)"
          hint="Optional"
          file={profilePhoto.file}
          uploading={profilePhoto.uploading}
          progress={profilePhoto.progress}
          accept="image/jpeg,image/png,image/webp,image/gif"
          uploadLabel="Upload"
          formats="Max 15 MB"
          inputRef={profilePhotoRef}
          onSelect={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onProfilePhotoSelect(file);
          }}
          onRemove={onProfilePhotoRemove}
          submitting={submitting}
          readOnly={identityLocked}
          variant="image"
          compact
          avatar
        />
      </div>
      <div className="verifier-location-block">
        <PartyInformationForm
          title="Location"
          compact
          showIdentity={false}
          locationCapture
          pincodeRequired
          disabled={submitting}
          lockAddressFields={identityLocked}
          values={verifierPartyFormValues(values.username, values.phone, values.email, values)}
          onChange={patch => onChange(locationPatchFromParty(patch))}
          footer={
            gpsMissing ? (
              <p className="verifier-gps-hint" role="status">
                {VERIFIER_GPS_REQUIRED_MESSAGE}
              </p>
            ) : null
          }
        />
      </div>
    </div>
  );
};
