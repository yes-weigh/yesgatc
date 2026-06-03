import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  Camera,
  ExternalLink,
  FileText,
  Plus,
  Receipt,
  RefreshCw,
  X,
} from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { ProductFileMeta } from '../lib/productApprovalUpload';
import { isPdfContentType } from '../lib/productApprovalUpload';
import { useImageFileInputs } from '../lib/useImageFileInputs';
import { shouldUseInAppCameraCapture, type ImageCaptureFacing } from '../lib/imageCapture';
import { ImageCaptureOverlay } from './ImageCaptureOverlay';

export type VerificationPhotoSlotIcon = 'camera' | 'document' | 'invoice';

type CameraSession = {
  slotKey: string;
  label: string;
  accept: string;
  onCaptured: (file: File) => void;
  onFallbackNativeCamera: () => void;
};

type VerificationPhotoSectionContextValue = {
  openInAppCamera: (session: CameraSession) => void;
};

const VerificationPhotoSectionContext = createContext<VerificationPhotoSectionContextValue | null>(
  null,
);

type VerificationPhotoUploadSlotProps = {
  /** Unique id within the parent upload section (e.g. image kind). */
  slotKey?: string;
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
  slotKey: slotKeyProp,
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
  const autoKey = useId();
  const slotKey = slotKeyProp ?? autoKey;
  const section = useContext(VerificationPhotoSectionContext);
  const locked = disabled || uploading;
  const hasFile = Boolean(file);

  const { mobileSourceChoice, openPicker, openCamera, openGallery, inputs } = useImageFileInputs(accept, {
    disabled: locked,
    onSelect,
  });

  const useInAppCamera = mobileSourceChoice && icon === 'camera' && shouldUseInAppCameraCapture();

  const handlePrimaryCapture = useCallback(() => {
    if (!mobileSourceChoice) {
      openPicker();
      return;
    }
    if (icon === 'camera') {
      if (useInAppCamera && section) {
        section.openInAppCamera({
          slotKey,
          label,
          accept,
          onCaptured: onSelect,
          onFallbackNativeCamera: () => openCamera(),
        });
      } else {
        openCamera();
      }
    } else {
      openGallery();
    }
  }, [
    mobileSourceChoice,
    icon,
    useInAppCamera,
    section,
    slotKey,
    label,
    onSelect,
    openPicker,
    openCamera,
    openGallery,
  ]);

  const labelNode = (
    <span className="verification-photo-slot-label">
      {label}
      {required && <span className="verification-photo-slot-required"> *</span>}
    </span>
  );

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

      {!hasFile && !uploading && mobileSourceChoice && (
        <div className="verification-photo-slot-frame">
          <button
            type="button"
            className="verification-photo-slot-icon-btn"
            onClick={handlePrimaryCapture}
            disabled={locked}
            aria-label={
              icon === 'camera'
                ? `${label}. Take photo with camera.`
                : `${label}. Upload file.`
            }
          >
            <SlotIcon kind={icon} />
          </button>
          {labelNode}
        </div>
      )}

      {!hasFile && !uploading && !mobileSourceChoice && (
        <button
          type="button"
          className="verification-photo-slot-trigger"
          onClick={handlePrimaryCapture}
          disabled={locked}
          aria-label={`${label}. Upload photo.`}
        >
          <div className="verification-photo-slot-frame">
            <SlotIcon kind={icon} />
            {labelNode}
          </div>
        </button>
      )}

      {uploading && (
        <div className="verification-photo-slot-frame verification-photo-slot-frame--busy" aria-busy="true">
          <span className="spinner-inline verification-photo-slot-spinner" aria-hidden />
          <span className="verification-photo-slot-progress">{progress}%</span>
          {labelNode}
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
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink size={14} />
              </a>
            )}
            <button
              type="button"
              className="verification-photo-slot-action"
              onClick={e => {
                e.stopPropagation();
                if (useInAppCamera && section) {
                  section.openInAppCamera({
                    slotKey,
                    label,
                    accept,
                    onCaptured: onSelect,
                    onFallbackNativeCamera: () => openCamera(),
                  });
                } else if (mobileSourceChoice && icon === 'camera') openCamera();
                else openPicker();
              }}
              disabled={locked}
              aria-label={`Replace ${label}`}
              title="Replace"
            >
              {mobileSourceChoice && icon === 'camera' ? <Camera size={14} /> : <RefreshCw size={14} />}
            </button>
            <button
              type="button"
              className="verification-photo-slot-action verification-photo-slot-action--danger"
              onClick={e => {
                e.stopPropagation();
                onRemove();
              }}
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
}) => {
  const [cameraSession, setCameraSession] = useState<CameraSession | null>(null);

  const openInAppCamera = useCallback((session: CameraSession) => {
    setCameraSession(session);
  }, []);

  const sectionContext = useMemo(() => ({ openInAppCamera }), [openInAppCamera]);

  const cameraFacing: ImageCaptureFacing = 'environment';

  return (
    <VerificationPhotoSectionContext.Provider value={sectionContext}>
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
      <ImageCaptureOverlay
        open={cameraSession !== null}
        label={cameraSession?.label ?? ''}
        accept={cameraSession?.accept}
        facing={cameraFacing}
        onClose={() => setCameraSession(null)}
        onCaptured={file => {
          cameraSession?.onCaptured(file);
          setCameraSession(null);
        }}
        onFallbackNativeCamera={() => {
          const session = cameraSession;
          session?.onFallbackNativeCamera();
          setCameraSession(null);
        }}
      />
    </VerificationPhotoSectionContext.Provider>
  );
};
