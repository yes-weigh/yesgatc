import React, { useRef } from 'react';
import { Building2, Eye, EyeOff, Pencil } from 'lucide-react';
import { formatAadharDisplay } from '../../lib/aadharAuth';
import { normalizePhone, normalizePincode } from '../../lib/contactFields';
import {
  normalizePanCard,
  normalizeRcCode,
  normalizeZohoId,
  RC_CODE_LENGTH,
  standardWeightsCertExpiryFromDate,
} from '../../lib/rcProfileFields';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import type { RcFormValues } from '../../lib/rcProfileFields';
import { StorageImage } from '../../components/StorageImage';
import {
  RC_CERTIFICATION_METHOD_OPTIONS,
  type RcCertificationMethod,
} from '../../lib/rcCertificationMethod';
import { PdfSignerSignEditor } from '../../components/PdfSignerSignEditor';
import { UploadField } from './productFormUi';

type RCFormFieldsProps = {
  mode: 'create' | 'edit';
  editing: boolean;
  values: RcFormValues;
  onChange: (patch: Partial<RcFormValues>) => void;
  logo: ProductFileMeta | null;
  logoUploading: boolean;
  onLogoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  cert: ProductFileMeta | null;
  certUploading: boolean;
  certProgress: number;
  onCertSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCertRemove: () => void;
  panCardImage: ProductFileMeta | null;
  panCardUploading: boolean;
  panCardProgress: number;
  onPanCardSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPanCardRemove: () => void;
  signerSign: ProductFileMeta | null;
  signerUploading: boolean;
  onSignerSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSignerRemove: () => void;
  submitting: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  loginAadhar?: string;
  canEditCertification: boolean;
  onStartEdit?: () => void;
  editArmed?: boolean;
  editBusy?: boolean;
};

export const RCFormFields: React.FC<RCFormFieldsProps> = ({
  mode,
  editing,
  values,
  onChange,
  logo,
  logoUploading,
  onLogoSelect,
  cert,
  certUploading,
  certProgress,
  onCertSelect,
  onCertRemove,
  panCardImage,
  panCardUploading,
  panCardProgress,
  onPanCardSelect,
  onPanCardRemove,
  signerSign,
  signerUploading,
  onSignerSelect,
  onSignerRemove,
  submitting,
  showPassword,
  onTogglePassword,
  loginAadhar,
  canEditCertification,
  onStartEdit,
  editArmed = false,
  editBusy = false,
}) => {
  const certInputRef = useRef<HTMLInputElement>(null);
  const panCardInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const signerInputRef = useRef<HTMLInputElement>(null);
  const certDueDate = standardWeightsCertExpiryFromDate(values.standardWeightsCertDate);
  const locked = mode === 'edit' && !editing;
  const canUploadFiles = !locked && (mode === 'edit' ? Boolean(loginAadhar) : values.aadhar.trim().length === 12);
  const fileUploadTitle = locked
    ? 'Tap the pencil to edit'
    : !canUploadFiles
      ? mode === 'create'
        ? 'Enter 12-digit Aadhar to upload'
        : 'Save center first'
      : undefined;

  return (
    <div className={`product-form-flat rc-form-flat${locked ? ' rc-form-flat--locked' : ''}`}>
      <div className="rc-form-dp">
        <input
          ref={logoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={onLogoSelect}
          disabled={locked || submitting || logoUploading}
        />
        <div className="rc-form-dp__cluster">
          <button
            type="button"
            className="rc-form-dp__btn"
            onClick={() => logoInputRef.current?.click()}
            disabled={locked || submitting || logoUploading}
            aria-label="RC logo"
          >
            {logo ? (
              <StorageImage
                url={logo.url}
                path={logo.path}
                alt=""
                className="rc-form-dp__img"
              />
            ) : (
              <Building2 size={28} strokeWidth={1.7} aria-hidden />
            )}
          </button>
          {onStartEdit ? (
            <button
              type="button"
              className={`rc-form-edit-btn${editArmed ? ' is-on' : ''}`}
              onClick={onStartEdit}
              disabled={editBusy || editArmed}
              aria-label="Edit regional center"
              aria-pressed={editArmed}
              title="Edit"
            >
              <Pencil size={14} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
        <span className="rc-form-dp__hint">Logo</span>
      </div>

      <fieldset className="rc-form-lock" disabled={locked || submitting}>
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
            <p id="rc-code-hint" className="text-muted text-xs mt-1 mb-0 rc-form-hint">
              Used in certificate remarks — e.g. Original verification by {values.rcCode || 'ABC'}
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
            <p id="rc-zoho-id-hint" className="text-muted text-xs mt-1 mb-0 rc-form-hint rc-form-hint--long">
              Zoho Books customer ID for RV invoicing (optional). Super Admin only — not shown on RC profile.
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
            iconActions
            readOnly={locked}
          />
        </div>
      </div>

      <div className="product-form-flat-row product-form-flat-row--scale rc-form-row-accounts">
        <span className="product-form-flat-row-title">Zoho labour expense &amp; PAN (Super Admin only)</span>
        <p className="text-muted text-xs mb-3 mt-0 rc-form-hint rc-form-hint--long">
          Not visible on the RC profile. Labour expense account is used for RV payout from GATC Wallet (chart of accounts ID, not a vendor contact). PAN is optional.
        </p>
        <div className="rc-form-grid rc-form-grid--main">
          <div className="form-group mb-0">
            <label htmlFor="rc-zoho-expense-account-id">Zoho labour expense account ID *</label>
            <input
              id="rc-zoho-expense-account-id"
              type="text"
              inputMode="numeric"
              className="input-field text-mono"
              placeholder="Chart of accounts ID"
              value={values.zohoExpenseAccountId}
              onChange={e => onChange({ zohoExpenseAccountId: normalizeZohoId(e.target.value) })}
              required
              spellCheck={false}
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-zoho-expense-account-name">Labour expense account name *</label>
            <input
              id="rc-zoho-expense-account-name"
              type="text"
              className="input-field"
              placeholder="Expense account name in Zoho Books"
              value={values.zohoExpenseAccountName}
              onChange={e => onChange({ zohoExpenseAccountName: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="rc-pan-card">PAN card</label>
            <input
              id="rc-pan-card"
              type="text"
              className="input-field text-mono"
              placeholder="ABCDE1234F (optional)"
              value={values.panCard}
              onChange={e => onChange({ panCard: normalizePanCard(e.target.value).slice(0, 10) })}
              maxLength={10}
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          <UploadField
            label="PAN card image"
            hint="Optional · PDF / image"
            uploadDisabled={!canUploadFiles}
            disabledReason={fileUploadTitle}
            file={panCardImage}
            uploading={panCardUploading}
            progress={panCardProgress}
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            uploadLabel="Upload"
            formats="Max 15 MB"
            inputRef={panCardInputRef}
            onSelect={onPanCardSelect}
            onRemove={onPanCardRemove}
            submitting={submitting}
            variant="document"
            compact
            iconActions
            readOnly={locked}
          />
        </div>
      </div>

      <div className="product-form-flat-row product-form-flat-row--scale rc-form-row-cert-settings">
        <span className="product-form-flat-row-title">Settings for certification</span>
        <div className="rc-cert-settings" role="radiogroup" aria-label="Certification method">
          {RC_CERTIFICATION_METHOD_OPTIONS.map(option => {
            const on = values.certificationMethod === option.id;
            const switchDisabled = locked || submitting || !canEditCertification;
            return (
              <button
                key={option.id}
                type="button"
                className={`rc-cert-settings__row${on ? ' is-on' : ''}`}
                role="radio"
                aria-checked={on}
                disabled={switchDisabled}
                onClick={() => onChange({ certificationMethod: option.id as RcCertificationMethod })}
              >
                <span>{option.label}</span>
                <span className={`rc-cert-settings__switch${on ? ' is-on' : ''}`} aria-hidden />
              </button>
            );
          })}
        </div>
        {!canEditCertification ? (
          <p className="text-muted text-xs mb-0 mt-2 rc-form-hint">Only Super Admin can change this.</p>
        ) : null}
        <p className="text-muted text-xs mb-0 mt-2 rc-form-hint">
          After 2304: worker generates the eMAAP PDF, DSC Engine / signer / manual stores the signed PDF,
          then the worker uploads it on Certificates Issued.
        </p>
        {values.certificationMethod === 'pdf_signer' ? (
          <div className="rc-pdf-signer-upload">
            <p className="text-muted text-xs mb-2 mt-3 rc-form-hint">
              Upload officer signature and name as one JPG or PNG.
            </p>
            {signerSign ? (
              <PdfSignerSignEditor
                file={signerSign}
                scale={values.pdfSignerSignScale}
                x={values.pdfSignerSignX}
                y={values.pdfSignerSignY}
                onLayoutChange={patch => onChange({
                  pdfSignerSignScale: patch.scale ?? values.pdfSignerSignScale,
                  pdfSignerSignX: patch.x ?? values.pdfSignerSignX,
                  pdfSignerSignY: patch.y ?? values.pdfSignerSignY,
                })}
                onReplace={onSignerSelect}
                disabled={locked || submitting || !canEditCertification}
                readOnly={locked || !canEditCertification}
                uploading={signerUploading}
              />
            ) : (
              <UploadField
                label="Signature & name"
                hint="JPG / PNG · required"
                uploadDisabled={!canUploadFiles || !canEditCertification}
                disabledReason={
                  !canEditCertification
                    ? 'Only Super Admin can change this.'
                    : fileUploadTitle
                }
                file={signerSign}
                uploading={signerUploading}
                progress={0}
                accept="image/jpeg,image/png"
                uploadLabel="Upload"
                formats="JPG or PNG"
                inputRef={signerInputRef}
                onSelect={onSignerSelect}
                onRemove={onSignerRemove}
                submitting={submitting}
                variant="image"
                compact
                iconActions
                readOnly={locked}
              />
            )}
          </div>
        ) : null}
      </div>
      </fieldset>
    </div>
  );
};
