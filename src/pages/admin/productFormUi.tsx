import React from 'react';
import { ExternalLink, FileText, Info, Upload, X } from 'lucide-react';
import { isPdfContentType, type ProductFileMeta } from '../../lib/productApprovalUpload';

export const FormSection: React.FC<{
  step: number;
  title: string;
  description?: string;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ step, title, description, compact, className, children }) => (
  <section
    className={`product-form-section${compact ? ' product-form-section--compact' : ''}${className ? ` ${className}` : ''}`}
  >
    <div className="product-form-section-head">
      <span className="product-form-step">{step}</span>
      <div>
        <h3 className="product-form-section-title">{title}</h3>
        {description && !compact && <p className="product-form-section-desc">{description}</p>}
      </div>
    </div>
    <div className="product-form-section-body">{children}</div>
  </section>
);

export const DefaultsStrip: React.FC<{
  items: { label: string; value: string }[];
}> = ({ items }) => (
  <div className="product-form-defaults" role="group" aria-label="Fixed product defaults">
    <span className="product-form-defaults-label">Defaults</span>
    <div className="product-form-defaults-chips">
      {items.map(item => (
        <span key={item.label} className="product-form-default-chip" title={item.value}>
          <span className="product-form-default-chip-key">{item.label}</span>
          <span className="product-form-default-chip-val">{item.value}</span>
        </span>
      ))}
    </div>
  </div>
);

export const UploadField: React.FC<{
  label: string;
  hint: string;
  disabledReason?: string;
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
  accept: string;
  uploadLabel: string;
  formats: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  submitting: boolean;
  variant?: 'image' | 'document';
  compact?: boolean;
  /** Keep dropzone visible (disabled) instead of swapping to the info panel */
  uploadDisabled?: boolean;
}> = ({
  label,
  hint,
  disabledReason,
  file,
  uploading,
  progress,
  accept,
  uploadLabel,
  formats,
  inputRef,
  onSelect,
  onRemove,
  submitting,
  variant = 'document',
  compact = false,
  uploadDisabled = false,
}) => (
  <div
    className={`product-upload-field product-upload-field--${variant}${compact ? ' product-upload-field--compact' : ''}`}
  >
    <div className="product-upload-field-head">
      <span className="product-upload-field-label">{label}</span>
      <span className="product-upload-field-hint">{hint}</span>
    </div>

    <div className="product-upload-field-body">
      {disabledReason && !uploadDisabled ? (
        <div className="product-upload-disabled">
          <Info size={16} className="text-muted shrink-0" />
          <p>{disabledReason}</p>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={onSelect}
            disabled={uploading || submitting}
          />

          {!file && !uploading && (
            <button
              type="button"
              className={`product-upload-dropzone${compact ? ' product-upload-dropzone--compact' : ''}`}
              onMouseDown={e => uploadDisabled && e.preventDefault()}
              onClick={() => !uploadDisabled && inputRef.current?.click()}
              disabled={submitting || uploadDisabled}
              title={uploadDisabled ? disabledReason : undefined}
            >
              <Upload size={compact ? 18 : 22} className="text-muted shrink-0" />
              <span className="product-upload-dropzone-text">
                <span className="product-upload-dropzone-title">{uploadLabel}</span>
                <span className="product-upload-dropzone-meta">{formats}</span>
              </span>
            </button>
          )}

          {uploading && (
            <div className={`product-upload-progress${compact ? ' product-upload-progress--compact' : ''}`}>
              <span className="spinner-inline"></span>
              <span className="text-sm text-muted">{progress}%</span>
              <div className="approval-progress-bar">
                <div className="approval-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {file && !uploading && (
            <div className={`product-upload-preview${compact ? ' product-upload-preview--compact' : ''}`}>
              {variant === 'image' || !isPdfContentType(file.contentType) ? (
                <img src={file.url} alt="" className="product-upload-preview-img" />
              ) : (
                <div className="product-upload-preview-icon">
                  <FileText size={compact ? 22 : 28} className="text-red" />
                </div>
              )}
              <div className="product-upload-preview-meta">
                <p className="truncate font-medium text-sm" title={file.name}>
                  {file.name}
                </p>
                <div className="product-upload-preview-actions">
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary text-xs py-1 px-2"
                  >
                    <ExternalLink size={12} /> View
                  </a>
                  <button
                    type="button"
                    className="btn btn-secondary text-xs py-1 px-2"
                    onClick={() => inputRef.current?.click()}
                    disabled={submitting}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary text-xs py-1 px-2 text-red"
                    onClick={onRemove}
                    disabled={submitting}
                  >
                    <X size={12} /> Remove
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  </div>
);

export const CalcLabel: React.FC<{ label: string; tooltip: string }> = ({ label, tooltip }) => (
  <label className="calc-field-label">
    <span>{label}</span>
    <span className="calc-field-hint" title={tooltip} aria-label={tooltip}>
      <Info size={14} />
    </span>
  </label>
);
