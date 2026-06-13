import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FlipHorizontal2, Image as ImageIcon, X, Zap, ZapOff } from 'lucide-react';
import {
  captureCanvasToJpegFile,
  freezeVideoFrame,
  produceStampedPhotoFromCanvas,
} from '../lib/captureImageFromVideo';
import type { ImageCaptureFacing } from '../lib/imageCapture';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { loadPhotoCaptureStamp, type PhotoCaptureStamp } from '../lib/photoCaptureStamp';

/** Gallery pickers on mobile open more reliably with `image/*` than a long MIME list. */
function galleryAcceptAttribute(accept: string): string {
  if (accept.split(',').some(part => part.trim().startsWith('image/'))) return 'image/*';
  return accept;
}

export type ImageCaptureSession = {
  onCaptured: (file: File) => void;
  /** Called when background geo overlay is ready (replaces preview file). */
  onStamped?: (file: File) => void;
  onFallbackNativeCamera?: () => void;
};

export type ImageCaptureOverlayProps = {
  open: boolean;
  label: string;
  accept?: string;
  facing?: ImageCaptureFacing;
  /** When false, hide gallery picker (live camera only). */
  allowGallery?: boolean;
  session: ImageCaptureSession | null;
  onClose: () => void;
};

export const ImageCaptureOverlay: React.FC<ImageCaptureOverlayProps> = ({
  open,
  label,
  accept = 'image/jpeg,image/png,image/webp,image/gif',
  facing: initialFacing = 'environment',
  allowGallery = true,
  session,
  onClose,
}) => {
  const galleryInputId = useId().replace(/:/g, '');
  const galleryAccept = galleryAcceptAttribute(accept);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<ImageCaptureFacing>(initialFacing);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [stampPrefetch, setStampPrefetch] = useState<PhotoCaptureStamp | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setReady(false);
  }, []);

  const startStream = useCallback(async () => {
    stopStream();
    setError(null);
    setReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera not available in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setReady(true);
    } catch {
      setError('Could not access the camera. Allow camera permission or choose from images.');
    }
  }, [facing, stopStream]);

  useEffect(() => {
    if (open) setFacing(initialFacing);
  }, [open, initialFacing]);

  useEffect(() => {
    if (!open) {
      stopStream();
      setFlashOn(false);
      setError(null);
      setCapturing(false);
      setStampPrefetch(null);
      return;
    }
    void startStream();
    return () => stopStream();
  }, [open, facing, startStream, stopStream]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('image-capture-overlay-open');
    return () => document.body.classList.remove('image-capture-overlay-open');
  }, [open]);

  useEffect(() => {
    if (!open || !session?.onStamped) return;
    let cancelled = false;
    void loadPhotoCaptureStamp().then(stamp => {
      if (!cancelled) setStampPrefetch(stamp);
    });
    return () => {
      cancelled = true;
    };
  }, [open, session?.onStamped]);

  const handleShutter = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready || capturing || !session) return;

    const frozenCanvas = freezeVideoFrame(video);
    if (!frozenCanvas) return;

    const capturedAt = new Date();
    const prefetch = stampPrefetch;
    const baseName = `photo-${Date.now()}.jpg`;

    setCapturing(true);
    stopStream();

    try {
      const immediate = await captureCanvasToJpegFile(frozenCanvas, { fileName: baseName });
      if (!immediate) return;

      session.onCaptured(immediate);
      onClose();

      if (session.onStamped) {
        void produceStampedPhotoFromCanvas(frozenCanvas, capturedAt, prefetch, baseName).then(
          stamped => {
            if (stamped) session.onStamped?.(stamped);
          },
        );
      }
    } finally {
      setCapturing(false);
    }
  }, [ready, capturing, session, stampPrefetch, stopStream, onClose]);

  const handleFlip = useCallback(() => {
    setFacing(prev => (prev === 'environment' ? 'user' : 'environment'));
  }, []);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  useHistoryOverlay(open, handleClose);

  const handleGalleryChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !session) return;
      stopStream();
      session.onCaptured(file);
      onClose();
    },
    [session, onClose, stopStream],
  );

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="image-capture-overlay" role="dialog" aria-modal="true" aria-label={label}>
      <div className="image-capture-overlay-top">
        <button
          type="button"
          className="image-capture-overlay-icon-btn"
          onClick={handleClose}
          aria-label="Close camera"
        >
          <X size={22} />
        </button>
        <span className="image-capture-overlay-title">{label}</span>
        <button
          type="button"
          className="image-capture-overlay-icon-btn"
          onClick={() => setFlashOn(v => !v)}
          aria-label={flashOn ? 'Flash on' : 'Flash off'}
          disabled
          title="Flash not supported in browser camera"
        >
          {flashOn ? <Zap size={20} /> : <ZapOff size={20} />}
        </button>
      </div>

      <div className="image-capture-overlay-viewport">
        {error ? (
          <div className="image-capture-overlay-error">
            <p>{error}</p>
            <div className="image-capture-overlay-error-actions">
              {allowGallery && (
                <label htmlFor={galleryInputId} className="image-capture-overlay-text-btn">
                  Select from images
                </label>
              )}
              {session?.onFallbackNativeCamera && (
                <button
                  type="button"
                  className="image-capture-overlay-text-btn"
                  onClick={() => {
                    stopStream();
                    session.onFallbackNativeCamera?.();
                    onClose();
                  }}
                >
                  Use device camera
                </button>
              )}
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="image-capture-overlay-video"
            playsInline
            muted
            autoPlay
          />
        )}
      </div>

      <div className="image-capture-overlay-bottom">
        <div className="image-capture-overlay-controls">
          {allowGallery ? (
            <label className="image-capture-overlay-gallery-btn">
              <input
                id={galleryInputId}
                type="file"
                accept={galleryAccept}
                className="image-capture-overlay-gallery-input"
                onChange={handleGalleryChange}
              />
              <ImageIcon size={22} aria-hidden />
              <span className="sr-only">Select from images</span>
            </label>
          ) : (
            <span className="image-capture-overlay-gallery-btn image-capture-overlay-gallery-btn--hidden" aria-hidden />
          )}

          <div className="image-capture-overlay-shutter-wrap">
            <span className="image-capture-overlay-mode">Photo</span>
            <button
              type="button"
              className="image-capture-overlay-shutter"
              onClick={() => void handleShutter()}
              disabled={!ready || capturing || Boolean(error)}
              aria-label="Take photo"
            />
          </div>

          <button
            type="button"
            className="image-capture-overlay-icon-btn image-capture-overlay-flip-btn"
            onClick={handleFlip}
            disabled={Boolean(error)}
            aria-label="Switch camera"
          >
            <FlipHorizontal2 size={22} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
