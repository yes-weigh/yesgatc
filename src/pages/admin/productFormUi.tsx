import React from 'react';
import { Camera, ExternalLink, FileText, Image as ImageIcon, Info, RefreshCw, Upload, X } from 'lucide-react';
import { StorageImage } from '../../components/StorageImage';
import { isPdfContentType, type ProductFileMeta } from '../../lib/productApprovalUpload';
import { mobileCameraUploadLabel } from '../../lib/imageCapture';
import { useImageFileInputs } from '../../lib/useImageFileInputs';

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
  /** Large circular photo — hides filename, icon-only replace/remove */
  avatar?: boolean;
  /** Thumbnail with icon-only replace/remove — no filename or text buttons */
  iconActions?: boolean;
  /** Keep dropzone visible (disabled) instead of swapping to the info panel */
  uploadDisabled?: boolean;
  /** Thumbnail shown in empty dropzone (e.g. verification image guide). */
  placeholderSrc?: string;
  /** Hide label row — use column headers or aria-label instead. */
  hideLabel?: boolean;
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
  inputRef: _inputRef,
  onSelect,
  onRemove,
  submitting,
  variant = 'document',
  compact = false,
  avatar = false,
  iconActions = false,
  uploadDisabled = false,
  placeholderSrc,
  hideLabel = false,
}) => {
  const useIconActions = avatar || iconActions;
  const showImagePreview = variant === 'image' || (file != null && !isPdfContentType(file.contentType));

  const forwardFileSelect = (file: File) => {
    const fileList = {
      0: file,
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
    } as unknown as FileList;
    onSelect({ target: { files: fileList, value: '' } } as React.ChangeEvent<HTMLInputElement>);
  };

  const { mobileSourceChoice, openPicker, openCamera, openGallery, inputs } = useImageFileInputs(accept, {
    avatar,
    disabled: uploading || submitting,
    onSelect: forwardFileSelect,
  });

  const dropzoneUploadLabel = mobileSourceChoice
    ? 'Add photo'
    : mobileCameraUploadLabel(uploadLabel, undefined);
  const dropzoneFormats = mobileSourceChoice ? 'Camera or gallery' : formats;

  return (
  <div
    className={`product-upload-field product-upload-field--${variant}${compact ? ' product-upload-field--compact' : ''}${avatar ? ' product-upload-field--avatar' : ''}${iconActions ? ' product-upload-field--icon-actions' : ''}${hideLabel ? ' product-upload-field--no-label' : ''}`}
  >
    {!hideLabel && (
      <div className="product-upload-field-head">
        <span className="product-upload-field-label">{label}</span>
        <span className="product-upload-field-hint">{hint}</span>
      </div>
    )}

    <div className="product-upload-field-body">
      {disabledReason && !uploadDisabled ? (
        <div className="product-upload-disabled">
          <Info size={16} className="text-muted shrink-0" />
          <p>{disabledReason}</p>
        </div>
      ) : (
        <>
          {inputs}

          {!file && !uploading && !mobileSourceChoice && (
            <button
              type="button"
              className={`product-upload-dropzone${compact ? ' product-upload-dropzone--compact' : ''}${avatar ? ' product-upload-dropzone--avatar' : ''}`}
              onMouseDown={e => uploadDisabled && e.preventDefault()}
              onClick={() => !uploadDisabled && openPicker()}
              disabled={submitting || uploadDisabled}
              title={uploadDisabled ? disabledReason : useIconActions ? `${dropzoneUploadLabel} · ${dropzoneFormats}` : undefined}
              aria-label={useIconActions ? `${label}. ${dropzoneUploadLabel}. ${dropzoneFormats}` : undefined}
            >
              {placeholderSrc ? (
                <img src={placeholderSrc} alt="" className="product-upload-placeholder-img" />
              ) : (
                <Upload size={avatar ? 28 : compact ? 18 : 22} className="text-muted shrink-0" />
              )}
              {!useIconActions && (
                <span className="product-upload-dropzone-text">
                  <span className="product-upload-dropzone-title">{dropzoneUploadLabel}</span>
                  <span className="product-upload-dropzone-meta">{dropzoneFormats}</span>
                </span>
              )}
            </button>
          )}

          {!file && !uploading && mobileSourceChoice && (
            <div
              className={`product-upload-dropzone product-upload-dropzone--sources${compact ? ' product-upload-dropzone--compact' : ''}${avatar ? ' product-upload-dropzone--avatar' : ''}`}
            >
              {placeholderSrc ? (
                <img src={placeholderSrc} alt="" className="product-upload-placeholder-img" />
              ) : (
                <Upload size={avatar ? 28 : compact ? 18 : 22} className="text-muted shrink-0" />
              )}
              {!useIconActions && (
                <span className="product-upload-dropzone-text">
                  <span className="product-upload-dropzone-title">{label}</span>
                  <span className="product-upload-dropzone-meta">{dropzoneFormats}</span>
                </span>
              )}
              <div className="product-upload-source-actions">
                <button
                  type="button"
                  className="product-upload-source-btn"
                  onClick={() => !uploadDisabled && openCamera()}
                  disabled={submitting || uploadDisabled}
                  aria-label={`${label}. Take photo with camera.`}
                >
                  <Camera size={14} aria-hidden />
                  Camera
                </button>
                <button
                  type="button"
                  className="product-upload-source-btn"
                  onClick={() => !uploadDisabled && openGallery()}
                  disabled={submitting || uploadDisabled}
                  aria-label={`${label}. Choose from gallery.`}
                >
                  <ImageIcon size={14} aria-hidden />
                  Gallery
                </button>
              </div>
            </div>
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
            <div
              className={`product-upload-preview${compact ? ' product-upload-preview--compact' : ''}${avatar ? ' product-upload-preview--avatar' : ''}`}
            >
              {useIconActions ? (
                <div className="product-upload-avatar-wrap">
                  {variant === 'image' || !isPdfContentType(file.contentType) ? (
                    <StorageImage
                      url={file.url}
                      path={file.path}
                      alt=""
                      className="product-upload-preview-img"
                      title={file.name}
                    />
                  ) : (
                    <div className="product-upload-preview-icon">
                      <FileText size={28} className="text-red" />
                    </div>
                  )}
                  <div className="product-upload-avatar-actions">
                    {file.url && !file.url.startsWith('blob:') && (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="product-upload-icon-btn"
                        aria-label="View photo"
                        title="View"
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                    {mobileSourceChoice ? (
                      <>
                        <button
                          type="button"
                          className="product-upload-icon-btn"
                          onClick={openCamera}
                          disabled={submitting}
                          aria-label="Replace photo with camera"
                          title="Camera"
                        >
                          <Camera size={16} />
                        </button>
                        <button
                          type="button"
                          className="product-upload-icon-btn"
                          onClick={openGallery}
                          disabled={submitting}
                          aria-label="Replace photo from gallery"
                          title="Gallery"
                        >
                          <ImageIcon size={16} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="product-upload-icon-btn"
                        onClick={openPicker}
                        disabled={submitting}
                        aria-label="Replace photo"
                        title="Replace"
                      >
                        <RefreshCw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="product-upload-icon-btn product-upload-icon-btn--danger"
                      onClick={onRemove}
                      disabled={submitting}
                      aria-label="Remove photo"
                      title="Remove"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {variant === 'image' || !isPdfContentType(file.contentType) ? (
                    <StorageImage
                      url={file.url}
                      path={file.path}
                      alt=""
                      className="product-upload-preview-img"
                      title={file.name}
                    />
                  ) : (
                    <div className="product-upload-preview-icon">
                      <FileText size={compact ? 22 : 28} className="text-red" />
                    </div>
                  )}
                  <div
                    className={`product-upload-preview-meta${showImagePreview ? ' product-upload-preview-meta--image-only' : ''}`}
                  >
                    {!showImagePreview && (
                      <p className="truncate font-medium text-sm" title={file.name}>
                        {file.name}
                      </p>
                    )}
                    <div className="product-upload-preview-actions">
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary text-xs py-1 px-2"
                      >
                        <ExternalLink size={12} /> View
                      </a>
                      {mobileSourceChoice ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary text-xs py-1 px-2"
                            onClick={openCamera}
                            disabled={submitting}
                          >
                            <Camera size={12} /> Camera
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary text-xs py-1 px-2"
                            onClick={openGallery}
                            disabled={submitting}
                          >
                            <ImageIcon size={12} /> Gallery
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary text-xs py-1 px-2"
                          onClick={openPicker}
                          disabled={submitting}
                        >
                          Replace
                        </button>
                      )}
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
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  </div>
  );
};

export const CalcLabel: React.FC<{ label: string; tooltip: string }> = ({ label, tooltip }) => (
  <label className="calc-field-label">
    <span>{label}</span>
    <span className="calc-field-hint" title={tooltip} aria-label={tooltip}>
      <Info size={14} />
    </span>
  </label>
);
