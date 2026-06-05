import React, { useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { normalizePhone, normalizePincode } from '../../lib/contactFields';
import {
  normalizeRcCode,
  normalizeZohoId,
  RC_CODE_LENGTH,
  standardWeightsCertExpiryFromDate,
} from '../../lib/rcProfileFields';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import type { RcFormValues } from '../../lib/rcProfileFields';
import { UploadField } from './productFormUi';

type RCFormFieldsProps = {
  mode: 'create' | 'edit';
  values: RcFormValues;
  onChange: (patch: Partial<RcFormValues>) => void;
  cert: ProductFileMeta | null;
  certUploading: boolean;
  certProgress: number;
  onCertSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCertRemove: () => void;
  seal: ProductFileMeta | null;
  sealUploading: boolean;
  sealProgress: number;
  onSealSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSealRemove: () => void;
  submitting: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  loginAadhar?: string;
};

export const RCFormFields: React.FC<RCFormFieldsProps> = ({
  mode,
  values,
  onChange,
  cert,
  certUploading,
  certProgress,
  onCertSelect,
  onCertRemove,
  seal,
  sealUploading,
  sealProgress,
  onSealSelect,
  onSealRemove,
  submitting,
  showPassword,
  onTogglePassword,
  loginAadhar,
}) => {
  const certInputRef = useRef<HTMLInputElement>(null);
  const sealInputRef = useRef<HTMLInputElement>(null);
  const certDueDate = standardWeightsCertExpiryFromDate(values.standardWeightsCertDate);
  const canUploadFiles = mode === 'edit' ? Boolean(loginAadhar) : values.aadhar.trim().length === 12;
  const fileUploadTitle = !canUploadFiles
    ? mode === 'create'
      ? 'Enter 12-digit Aadhar to upload'
      : 'Save center first'
    : undefined;

  return (
    <div className="product-form-flat rc-form-flat">
      <div className="product-form-flat-row rc-form-row-main">
        <div className="rc-form-grid rc-form-grid--main">
          <div className="form-group mb-0">
            <label htmlFor="rc-company">Company / Center *</label>
            <input
              id="rc-company"
              type="text"
              className="input-field"
              placeholder="Center name"
              value={values.companyName}
              onChange={e => onChange({ companyName: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-contact">Contact Person *</label>
            <input
              id="rc-contact"
              type="text"
              className="input-field"
              placeholder="Contact name"
              value={values.contactPerson}
              onChange={e => onChange({ contactPerson: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-place">Place *</label>
            <input
              id="rc-place"
              type="text"
              className="input-field"
              placeholder="City / town / area"
              value={values.place}
              onChange={e => onChange({ place: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-code">RC code *</label>
            <input
              id="rc-code"
              type="text"
              className="input-field text-mono rc-form-code-input"
              placeholder="3 letters or digits"
              value={values.rcCode}
              onChange={e => onChange({ rcCode: normalizeRcCode(e.target.value) })}
              required
              maxLength={RC_CODE_LENGTH}
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="rc-code-hint"
            />
            <p id="rc-code-hint" className="text-muted text-xs mt-1 mb-0">
              Used in DOCA remarks — e.g. Original verification by {values.rcCode || 'ABC'}
            </p>
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-zoho-id">Zoho customer ID</label>
            <input
              id="rc-zoho-id"
              type="text"
              inputMode="numeric"
              className="input-field text-mono"
              placeholder="Zoho Books contact ID"
              value={values.zohoId}
              onChange={e => onChange({ zohoId: normalizeZohoId(e.target.value) })}
              spellCheck={false}
              aria-describedby="rc-zoho-id-hint"
            />
            <p id="rc-zoho-id-hint" className="text-muted text-xs mt-1 mb-0">
              Zoho Books customer ID for RV invoicing (optional).
            </p>
          </div>
          {mode === 'create' ? (
            <div className="form-group mb-0">
              <label htmlFor="rc-aadhar">Aadhar (login) *</label>
              <input
                id="rc-aadhar"
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
            <div className="form-group mb-0 rc-form-aadhar-readonly">
              <label>Login Aadhar</label>
              <p className="rc-form-aadhar-value">{formatAadharDisplay(loginAadhar ?? '')}</p>
            </div>
          )}
          <div className="form-group mb-0">
            <label htmlFor="rc-email">Email *</label>
            <input
              id="rc-email"
              type="email"
              className="input-field"
              placeholder="rc@example.com"
              autoComplete="off"
              value={values.email}
              onChange={e => onChange({ email: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-phone">Phone *</label>
            <input
              id="rc-phone"
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
            <label htmlFor="rc-gst">GST *</label>
            <input
              id="rc-gst"
              type="text"
              className="input-field"
              placeholder="GSTIN"
              value={values.gstNumber}
              onChange={e => onChange({ gstNumber: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-password">
              {mode === 'create' ? 'Password *' : 'Reset password'}
            </label>
            <div className="input-icon-wrap">
              <input
                id="rc-password"
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
        </div>
      </div>

      <div className="product-form-flat-row rc-form-row-address">
        <div className="rc-form-grid rc-form-grid--address">
          <div className="form-group mb-0">
            <label htmlFor="rc-pincode">Postal code</label>
            <input
              id="rc-pincode"
              type="text"
              inputMode="numeric"
              className="input-field"
              placeholder="6-digit PIN"
              value={values.pincode}
              onChange={e => onChange({ pincode: normalizePincode(e.target.value) })}
              maxLength={6}
            />
          </div>
          <div className="form-group mb-0 rc-form-address">
            <label htmlFor="rc-address">Full address *</label>
            <textarea
              id="rc-address"
              className="input-field rc-form-address-input"
              rows={2}
              placeholder="Street, city, state"
              value={values.address}
              onChange={e => onChange({ address: e.target.value })}
              required
            />
          </div>
        </div>
      </div>

      <div className="product-form-flat-row product-form-flat-row--scale rc-form-row-cert">
        <span className="product-form-flat-row-title">Std. weights cert. (optional)</span>
        <div className="rc-form-grid rc-form-grid--cert">
          <div className="form-group mb-0">
            <label htmlFor="rc-cert-no">Cert. number</label>
            <input
              id="rc-cert-no"
              type="text"
              className="input-field"
              placeholder="Reference no."
              value={values.standardWeightsCertNumber}
              onChange={e => onChange({ standardWeightsCertNumber: e.target.value })}
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-cert-date">Cert. date</label>
            <input
              id="rc-cert-date"
              type="date"
              className="input-field"
              value={values.standardWeightsCertDate}
              onChange={e => onChange({ standardWeightsCertDate: e.target.value })}
            />
          </div>
          <div className="form-group mb-0 calc-field">
            <label htmlFor="rc-cert-due">Due date</label>
            <input
              id="rc-cert-due"
              type="text"
              className="input-field input-readonly"
              value={certDueDate || '—'}
              readOnly
              tabIndex={-1}
              aria-readonly="true"
              title="Certificate date + 1 year"
            />
          </div>
          <UploadField
            label="Document"
            hint="PDF / image"
            uploadDisabled={!canUploadFiles}
            disabledReason={fileUploadTitle}
            file={cert}
            uploading={certUploading}
            progress={certProgress}
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            uploadLabel="Upload"
            formats="Max 15 MB"
            inputRef={certInputRef}
            onSelect={onCertSelect}
            onRemove={onCertRemove}
            submitting={submitting}
            variant="document"
            compact
          />
        </div>
      </div>

      <div className="product-form-flat-row product-form-flat-row--scale rc-form-row-seal">
        <span className="product-form-flat-row-title">RC seal (optional)</span>
        <div className="rc-form-grid rc-form-grid--seal">
          <UploadField
            label="Seal image"
            hint="PNG only"
            uploadDisabled={!canUploadFiles}
            disabledReason={fileUploadTitle}
            file={seal}
            uploading={sealUploading}
            progress={sealProgress}
            accept="image/png"
            uploadLabel="Upload PNG"
            formats="Transparent background"
            inputRef={sealInputRef}
            onSelect={onSealSelect}
            onRemove={onSealRemove}
            submitting={submitting}
            variant="image"
            compact
          />
          <p className="rc-form-seal-note text-muted text-xs mb-0">
            Strict: PNG with transparent background only.
          </p>
        </div>
      </div>
    </div>
  );
};
