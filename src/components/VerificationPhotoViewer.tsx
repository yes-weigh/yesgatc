import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { StorageImage } from './StorageImage';

export type VerificationPhotoViewerImage = {
  id?: string;
  label: string;
  url: string;
  path?: string;
};

type VerificationPhotoViewerProps = {
  open: boolean;
  onClose: () => void;
  stampPending?: boolean;
  /** Single-image shorthand */
  label?: string;
  imageUrl?: string;
  storagePath?: string;
  /** Multi-image gallery */
  images?: VerificationPhotoViewerImage[];
  initialIndex?: number;
};

export const VerificationPhotoViewer: React.FC<VerificationPhotoViewerProps> = ({
  open,
  onClose,
  stampPending = false,
  label = 'Photo',
  imageUrl = '',
  storagePath = '',
  images,
  initialIndex = 0,
}) => {
  const gallery = useMemo<VerificationPhotoViewerImage[]>(() => {
    if (images?.length) return images;
    if (imageUrl) {
      return [{ label, url: imageUrl, path: storagePath }];
    }
    return [];
  }, [images, imageUrl, label, storagePath]);

  const [index, setIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;
    const safeIndex = Math.min(Math.max(0, initialIndex), Math.max(0, gallery.length - 1));
    setIndex(safeIndex);
  }, [open, initialIndex, gallery.length]);

  const hasMultiple = gallery.length > 1;
  const current = gallery[index] ?? null;
  const canGoPrev = hasMultiple && index > 0;
  const canGoNext = hasMultiple && index < gallery.length - 1;

  const goPrev = useCallback(() => {
    setIndex(prev => Math.max(0, prev - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex(prev => Math.min(gallery.length - 1, prev + 1));
  }, [gallery.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' && canGoPrev) goPrev();
      if (e.key === 'ArrowRight' && canGoNext) goNext();
    };
    document.body.classList.add('verification-photo-viewer-open');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('verification-photo-viewer-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, canGoPrev, canGoNext, goPrev, goNext]);

  if (!open || typeof document === 'undefined' || !current) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Require a mostly-horizontal swipe so vertical page scroll doesn't change photos.
    if (absX < 36 || absX <= absY) return;

    if (deltaX > 0 && canGoPrev) goPrev();
    else if (deltaX < 0 && canGoNext) goNext();
  };

  const handleTouchCancel = () => {
    touchStart.current = null;
  };

  return createPortal(
    <div
      className="verification-photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo gallery: ${current.label}`}
      onClick={onClose}
    >
      <div className="verification-photo-viewer-backdrop" aria-hidden />

      <div className="verification-photo-viewer-shell" onClick={e => e.stopPropagation()}>
        <header className="verification-photo-viewer-top">
          <button
            type="button"
            className="verification-photo-viewer-close"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X size={22} />
          </button>
          <div className="verification-photo-viewer-title-wrap">
            <span className="verification-photo-viewer-title">{current.label}</span>
            {hasMultiple && (
              <span className="verification-photo-viewer-counter">
                {index + 1} of {gallery.length}
              </span>
            )}
          </div>
          <span className="verification-photo-viewer-top-spacer" aria-hidden />
        </header>

        <div
          className="verification-photo-viewer-stage"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        >
          {canGoPrev && (
            <button
              type="button"
              className="verification-photo-viewer-nav verification-photo-viewer-nav--prev"
              onClick={goPrev}
              aria-label="Previous photo"
            >
              <ChevronLeft size={24} strokeWidth={2.25} />
            </button>
          )}

          <div className="verification-photo-viewer-frame">
            <StorageImage
              key={`${current.url}-${index}`}
              url={current.url}
              path={current.path ?? ''}
              alt={current.label}
              className="verification-photo-viewer-img"
            />
          </div>

          {canGoNext && (
            <button
              type="button"
              className="verification-photo-viewer-nav verification-photo-viewer-nav--next"
              onClick={goNext}
              aria-label="Next photo"
            >
              <ChevronRight size={24} strokeWidth={2.25} />
            </button>
          )}
        </div>

        {hasMultiple && (
          <div className="verification-photo-viewer-indicators" role="tablist" aria-label="Photo navigation">
            {gallery.map((item, dotIndex) => (
              <button
                key={item.id ?? `${item.label}-${dotIndex}`}
                type="button"
                role="tab"
                className={`verification-photo-viewer-dot${dotIndex === index ? ' is-active' : ''}`}
                aria-selected={dotIndex === index}
                aria-label={`${item.label} (${dotIndex + 1} of ${gallery.length})`}
                onClick={() => setIndex(dotIndex)}
              />
            ))}
          </div>
        )}

        <p className="verification-photo-viewer-hint">
          {stampPending
            ? 'Adding location overlay…'
            : hasMultiple
              ? 'Swipe or use arrows to browse · Tap outside to close'
              : 'Tap outside to close'}
        </p>
      </div>
    </div>,
    document.body,
  );
};
