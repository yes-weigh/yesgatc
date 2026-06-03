import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { StorageImage } from './StorageImage';

type VerificationPhotoViewerProps = {
  open: boolean;
  label: string;
  imageUrl: string;
  storagePath?: string;
  stampPending?: boolean;
  onClose: () => void;
};

export const VerificationPhotoViewer: React.FC<VerificationPhotoViewerProps> = ({
  open,
  label,
  imageUrl,
  storagePath = '',
  stampPending = false,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.body.classList.add('verification-photo-viewer-open');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('verification-photo-viewer-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="verification-photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${label}`}
      onClick={onClose}
    >
      <div className="verification-photo-viewer-top">
        <button
          type="button"
          className="verification-photo-viewer-close"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X size={22} />
        </button>
        <span className="verification-photo-viewer-title">{label}</span>
      </div>
      <div
        className="verification-photo-viewer-body"
        onClick={e => e.stopPropagation()}
      >
        <StorageImage
          url={imageUrl}
          path={storagePath}
          alt={label}
          className="verification-photo-viewer-img"
        />
      </div>
      <p className="verification-photo-viewer-hint">
        {stampPending ? 'Adding location overlay… Tap outside to close' : 'Tap outside to close'}
      </p>
    </div>,
    document.body,
  );
};
