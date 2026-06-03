import React from 'react';
import {
  Camera,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Plus,
  Receipt,
  RefreshCw,
  X,
} from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { ProductFileMeta } from '../lib/productApprovalUpload';
import { isPdfContentType } from '../lib/productApprovalUpload';
import { useImageFileInputs } from '../lib/useImageFileInputs';

export type VerificationPhotoSlotIcon = 'camera' | 'document' | 'invoice';

type VerificationPhotoUploadSlotProps = {
  label: string;
  required?: boolean;
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
  disabled?: boolean;
  accept?: string;
  onSelect: (file: File) => void;
  onRemove: () => void;
  icon?: VerificationPhotoSlotIcon;
};

const SlotIcon: React.FC<{ kind: VerificationPhotoSlotIcon }> = ({ kind }) => {
  if (kind === 'document') {
    return (
      <span className="verification-photo-slot-icon verification-photo-slot-icon--doc" aria-hidden>
        <FileText size={26} strokeWidth={1.5} />
      </span>
    );
  }
  if (kind === 'invoice') {
    return (
      <span className="verification-photo-slot-icon verification-photo-slot-icon--doc" aria-hidden>
        <Receipt size={26} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <span className="verification-photo-slot-icon" aria-hidden>
      <Camera size={26} strokeWidth={1.5} />
      <Plus size={11} className="verification-photo-slot-icon-plus" />
    </span>
  );
};

export const VerificationPhotoUploadSlot: React.FC<VerificationPhotoUploadSlotProps> = ({
  label,
  required = false,
  file,
  uploading,
  progress,
  disabled = false,
  accept = 'image/jpeg,image/png,image/webp,image/gif',
  onSelect,
  onRemove,
  icon = 'camera',
}) => {
  const locked = disabled || uploading;
  const hasFile = Boolean(file);

  const { mobileSourceChoice, openPicker, openCamera, openGallery, inputs } = useImageFileInputs(accept, {
    disabled: locked,
    onSelect,
  });

  return (
    <div
      className={[
        'verification-photo-slot',
        hasFile ? 'verification-photo-slot--filled' : '',
        uploading ? 'verification-photo-slot--uploading' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {inputs}

      {!hasFile && !uploading && !mobileSourceChoice && (
        <button
          type="button"
          className="verification-photo-slot-trigger"
          onClick={openPicker}
          disabled={locked}
          aria-label={`${label}. Upload photo.`}
        >
          <div className="verification-photo-slot-frame">
            <SlotIcon kind={icon} />
            <span className="verification-photo-slot-label">
              {label}
              {required && <span className="verification-photo-slot-required"> *</span>}
            </span>
          </div>
        </button>
      )}

      {!hasFile && !uploading && mobileSourceChoice && (
        <div className="verification-photo-slot-frame verification-photo-slot-frame--sources">
          <SlotIcon kind={icon} />
          <span className="verification-photo-slot-label">
            {label}
            {required && <span className="verification-photo-slot-required"> *</span>}
          </span>
          <div className="verification-photo-slot-source-actions">
            <button
              type="button"
              className="verification-photo-slot-source-btn"
              onClick={openCamera}
              disabled={locked}
              aria-label={`${label}. Take photo with camera.`}
            >
              <Camera size={14} aria-hidden />
              Camera
            </button>
            <button
              type="button"
              className="verification-photo-slot-source-btn"
              onClick={openGallery}
              disabled={locked}
              aria-label={`${label}. Choose from gallery.`}
            >
              <ImageIcon size={14} aria-hidden />
              Gallery
            </button>
          </div>
        </div>
      )}

      {uploading && (
        <div className="verification-photo-slot-frame verification-photo-slot-frame--busy" aria-busy="true">
          <span className="spinner-inline verification-photo-slot-spinner" aria-hidden />
          <span className="verification-photo-slot-progress">{progress}%</span>
          <span className="verification-photo-slot-label">
            {label}
            {required && <span className="verification-photo-slot-required"> *</span>}
          </span>
        </div>
      )}

      {hasFile && !uploading && (
        <div className="verification-photo-slot-frame verification-photo-slot-frame--preview">
          {file && !isPdfContentType(file.contentType) ? (
            <StorageImage
              url={file.url}
              path={file.path}
              alt=""
              className="verification-photo-slot-preview"
            />
          ) : (
            <div className="verification-photo-slot-doc-icon">
              <FileText size={28} aria-hidden />
            </div>
          )}
          <div className="verification-photo-slot-actions">
            {file?.url && !file.url.startsWith('blob:') && (
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="verification-photo-slot-action"
                aria-label={`View ${label}`}
                title="View"
              >
                <ExternalLink size={14} />
              </a>
            )}
            {mobileSourceChoice ? (
              <>
                <button
                  type="button"
                  className="verification-photo-slot-action"
                  onClick={openCamera}
                  disabled={locked}
                  aria-label={`Replace ${label} with camera`}
                  title="Camera"
                >
                  <Camera size={14} />
                </button>
                <button
                  type="button"
                  className="verification-photo-slot-action"
                  onClick={openGallery}
                  disabled={locked}
                  aria-label={`Replace ${label} from gallery`}
                  title="Gallery"
                >
                  <ImageIcon size={14} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="verification-photo-slot-action"
                onClick={openPicker}
                disabled={locked}
                aria-label={`Replace ${label}`}
                title="Replace"
              >
                <RefreshCw size={14} />
              </button>
            )}
            <button
              type="button"
              className="verification-photo-slot-action verification-photo-slot-action--danger"
              onClick={onRemove}
              disabled={locked}
              aria-label={`Remove ${label}`}
              title="Remove"
            >
              <X size={14} />
            </button>
          </div>
          <span className="verification-photo-slot-label verification-photo-slot-label--overlay">
            {label}
            {required && <span className="verification-photo-slot-required"> *</span>}
          </span>
        </div>
      )}
    </div>
  );
};

type VerificationPhotoUploadSectionProps = {
  title: string;
  children: React.ReactNode;
  columns?: 2 | 3;
  headerIcon?: 'camera' | 'document';
};

export const VerificationPhotoUploadSection: React.FC<VerificationPhotoUploadSectionProps> = ({
  title,
  children,
  columns = 3,
  headerIcon = 'camera',
}) => (
  <section className="verification-photo-upload-section">
    <header className="verification-photo-upload-section-head">
      <span className="verification-photo-upload-section-head-icon" aria-hidden>
        {headerIcon === 'document' ? <FileText size={16} /> : <Camera size={16} />}
      </span>
      <h4 className="verification-photo-upload-section-title">{title}</h4>
    </header>
    <div
      className={[
        'verification-photo-upload-grid',
        columns === 2 ? 'verification-photo-upload-grid--two' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  </section>
);
