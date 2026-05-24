import React, { useRef } from 'react';
import { Eye, EyeOff, Zap, ClipboardList } from 'lucide-react';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { normalizePhone, normalizePincode } from '../../lib/contactFields';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import type { VctDocKey } from '../../lib/vctProfileFields';
import { VCT_DOC_KEYS, VCT_DOC_LABELS } from '../../lib/vctProfileFields';
import { UploadField } from '../admin/productFormUi';
import type { WorkflowMode } from '../../types';

export type VctFormValues = {
  username: string;
  aadhar: string;
  phone: string;
  address: string;
  pincode: string;
  policeStation: string;
  secondaryContactName: string;
  secondaryContactRelationship: string;
  secondaryContactPhone: string;
  password: string;
  workflowMode: WorkflowMode;
};

export const EMPTY_VCT_FORM: VctFormValues = {
  username: '',
  aadhar: '',
  phone: '',
  address: '',
  pincode: '',
  policeStation: '',
  secondaryContactName: '',
  secondaryContactRelationship: '',
  secondaryContactPhone: '',
  password: '',
  workflowMode: 'auto',
};

export type VctDocUploadState = {
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
};

export const EMPTY_VCT_DOC_STATE: VctDocUploadState = {
  file: null,
  uploading: false,
  progress: 0,
};

export const ModeToggle = ({
  value,
  onChange,
}: {
  value: WorkflowMode;
  onChange: (m: WorkflowMode) => void;
}) => (
  <div className="mode-toggle mode-toggle--vct">
    <button
      type="button"
      className={`mode-btn ${value === 'auto' ? 'active-auto' : ''}`}
      onClick={() => onChange('auto')}
    >
      <Zap size={13} /> Auto
    </button>
    <button
      type="button"
      className={`mode-btn ${value === 'manual' ? 'active-manual' : ''}`}
      onClick={() => onChange('manual')}
    >
      <ClipboardList size={13} /> Manual
    </button>
  </div>
);

type VCTFormFieldsProps = {
  mode: 'create' | 'edit';
  values: VctFormValues;
  onChange: (patch: Partial<VctFormValues>) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  loginAadhar?: string;
  profilePhoto: VctDocUploadState;
  onProfilePhotoSelect: (file: File) => void;
  onProfilePhotoRemove: () => void;
  docStates: Record<VctDocKey, VctDocUploadState>;
  onDocSelect: (key: VctDocKey, file: File) => void;
  onDocRemove: (key: VctDocKey) => void;
  submitting: boolean;
};

export const VCTFormFields: React.FC<VCTFormFieldsProps> = ({
  mode,
  values,
  onChange,
  showPassword,
  onTogglePassword,
  loginAadhar,
  profilePhoto,
  onProfilePhotoSelect,
  onProfilePhotoRemove,
  docStates,
  onDocSelect,
  onDocRemove,
  submitting,
}) => {
  const aadharDocRef = useRef<HTMLInputElement>(null);
  const biodataRef = useRef<HTMLInputElement>(null);
  const educationRef = useRef<HTMLInputElement>(null);
  const pccRef = useRef<HTMLInputElement>(null);
  const profilePhotoRef = useRef<HTMLInputElement>(null);

  const docRefs: Record<VctDocKey, React.RefObject<HTMLInputElement | null>> = {
    aadharDoc: aadharDocRef,
    biodata: biodataRef,
    educationCert: educationRef,
    pcc: pccRef,
  };

  const handleDocInput = (key: VctDocKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onDocSelect(key, file);
  };

  const handleProfilePhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onProfilePhotoSelect(file);
  };

  return (
    <div className="product-form-flat vct-form-flat">
      <div className="product-form-flat-row vct-form-hero">
        <div className="vct-form-hero-photo">
          <UploadField
            label="Profile photo"
            hint="Optional"
            file={profilePhoto.file}
            uploading={profilePhoto.uploading}
            progress={profilePhoto.progress}
            accept="image/jpeg,image/png,image/webp,image/gif"
            uploadLabel="Upload"
            formats="Max 15 MB"
            inputRef={profilePhotoRef}
            onSelect={handleProfilePhotoInput}
            onRemove={onProfilePhotoRemove}
            submitting={submitting}
            variant="image"
            compact
            avatar
          />
        </div>

        <div className="vct-form-hero-fields">
          <div className="vct-form-grid vct-form-grid--identity">
            <div className="form-group mb-0">
              <label htmlFor="vct-name">Full Name *</label>
              <input
                id="vct-name"
                type="text"
                className="input-field"
                placeholder="e.g. Amit Sharma"
                value={values.username}
                onChange={e => onChange({ username: e.target.value })}
                required
                autoFocus={mode === 'create'}
              />
            </div>
            {mode === 'create' ? (
              <div className="form-group mb-0">
                <label htmlFor="vct-aadhar">Aadhar *</label>
                <input
                  id="vct-aadhar"
                  type="text"
                  inputMode="numeric"
                  className="input-field"
                  placeholder="12 digits"
                  value={values.aadhar}
                  onChange={e => onChange({ aadhar: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                  required
                  maxLength={12}
                />
              </div>
            ) : (
              <div className="form-group mb-0 vct-form-aadhar-readonly">
                <label>Aadhar</label>
                <p className="vct-form-aadhar-value">{formatAadharDisplay(loginAadhar ?? '')}</p>
              </div>
            )}
            <div className="form-group mb-0">
              <label htmlFor="vct-phone">Mobile *</label>
              <input
                id="vct-phone"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="10-digit"
                value={values.phone}
                onChange={e => onChange({ phone: normalizePhone(e.target.value) })}
                required
                maxLength={10}
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vct-pincode">Postal code *</label>
              <input
                id="vct-pincode"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="6-digit"
                value={values.pincode}
                onChange={e => onChange({ pincode: normalizePincode(e.target.value) })}
                required
                maxLength={6}
              />
            </div>
            <div className="form-group mb-0 vct-form-span-full vct-form-address">
              <label htmlFor="vct-address">Residential Address *</label>
              <input
                id="vct-address"
                type="text"
                className="input-field"
                placeholder="House no., street, locality, city, state"
                value={values.address}
                onChange={e => onChange({ address: e.target.value })}
                required
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vct-police-station">Police Station *</label>
              <input
                id="vct-police-station"
                type="text"
                className="input-field"
                placeholder="PCC issuing station"
                value={values.policeStation}
                onChange={e => onChange({ policeStation: e.target.value })}
                required
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vct-secondary-name">Emergency Contact *</label>
              <input
                id="vct-secondary-name"
                type="text"
                className="input-field"
                placeholder="Full name"
                value={values.secondaryContactName}
                onChange={e => onChange({ secondaryContactName: e.target.value })}
                required
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vct-secondary-rel">Relationship *</label>
              <input
                id="vct-secondary-rel"
                type="text"
                className="input-field"
                placeholder="e.g. Spouse"
                value={values.secondaryContactRelationship}
                onChange={e => onChange({ secondaryContactRelationship: e.target.value })}
                required
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vct-secondary-phone">Emergency Phone *</label>
              <input
                id="vct-secondary-phone"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="10-digit"
                value={values.secondaryContactPhone}
                onChange={e => onChange({ secondaryContactPhone: normalizePhone(e.target.value) })}
                required
                maxLength={10}
              />
            </div>
            <div className="form-group mb-0 vct-form-span-2">
              <label htmlFor="vct-password">
                {mode === 'create' ? 'Password *' : 'Reset password'}
              </label>
              <div className="input-icon-wrap">
                <input
                  id="vct-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field"
                  placeholder={mode === 'create' ? 'min. 6 chars' : 'Optional'}
                  autoComplete="new-password"
                  value={values.password}
                  onChange={e => onChange({ password: e.target.value })}
                  required={mode === 'create'}
                  minLength={mode === 'create' ? 6 : undefined}
                />
                <button
                  type="button"
                  className="input-icon-right"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onMouseDown={e => e.preventDefault()}
                  onClick={onTogglePassword}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group mb-0 vct-form-span-2 vct-form-job-mode">
              <label>Job Mode *</label>
              <ModeToggle
                value={values.workflowMode}
                onChange={m => onChange({ workflowMode: m })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="product-form-flat-row vct-form-row-docs">
        {VCT_DOC_KEYS.map(key => {
          const meta = VCT_DOC_LABELS[key];
          const state = docStates[key];
          return (
            <UploadField
              key={key}
              label={meta.label}
              hint={meta.hint}
              file={state.file}
              uploading={state.uploading}
              progress={state.progress}
              accept=".pdf,image/jpeg,image/png,image/webp,image/gif"
              uploadLabel="Choose file"
              formats="PDF or image · max 15 MB"
              inputRef={docRefs[key]}
              onSelect={handleDocInput(key)}
              onRemove={() => onDocRemove(key)}
              submitting={submitting}
              variant="document"
              compact
            />
          );
        })}
      </div>
    </div>
  );
};
