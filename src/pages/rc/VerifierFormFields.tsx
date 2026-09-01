import React, { useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { normalizePhone } from '../../lib/contactFields';
import { UploadField } from '../admin/productFormUi';
import type { ImageUploadState } from './CustomerFormFields';

export type VerifierFormValues = {
  username: string;
  aadhar: string;
  phone: string;
  email: string;
  password: string;
};

export const EMPTY_VERIFIER_FORM: VerifierFormValues = {
  username: '',
  aadhar: '',
  phone: '',
  email: '',
  password: '',
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
};

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
}) => {
  const profilePhotoRef = useRef<HTMLInputElement>(null);

  return (
    <div className="form-grid">
    <div className="form-group">
      <label htmlFor="verifier-name">Full name</label>
      <input
        id="verifier-name"
        className="input-field"
        value={values.username}
        onChange={e => onChange({ username: e.target.value })}
        autoComplete="off"
        required
      />
    </div>
    <div className="form-group">
      <label htmlFor="verifier-aadhar">Login Aadhar (not phone)</label>
      <input
        id="verifier-aadhar"
        className="input-field"
        inputMode="numeric"
        value={mode === 'edit' ? formatAadharDisplay(loginAadhar || values.aadhar) : values.aadhar}
        onChange={e => onChange({ aadhar: e.target.value.replace(/\D/g, '').slice(0, 12) })}
        disabled={mode === 'edit'}
        autoComplete="off"
        required={mode === 'create'}
      />
    </div>
    <div className="form-group">
      <label htmlFor="verifier-phone">Primary phone</label>
      <input
        id="verifier-phone"
        className="input-field"
        inputMode="numeric"
        value={values.phone}
        onChange={e => onChange({ phone: normalizePhone(e.target.value) })}
        autoComplete="off"
        required
      />
    </div>
    <div className="form-group">
      <label htmlFor="verifier-email">Contact email</label>
      <input
        id="verifier-email"
        className="input-field"
        type="email"
        value={values.email}
        onChange={e => onChange({ email: e.target.value })}
        autoComplete="off"
      />
    </div>
    <div className="form-group">
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
        />
        <button
          type="button"
          className="input-icon-btn"
          onClick={onTogglePassword}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
    <div className="form-group">
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
        variant="image"
        compact
        avatar
      />
    </div>
  </div>
  );
};
