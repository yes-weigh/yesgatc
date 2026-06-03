import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FlipHorizontal2, Image as ImageIcon, X, Zap, ZapOff } from 'lucide-react';
import { captureImageFileFromVideo } from '../lib/captureImageFromVideo';
import type { ImageCaptureFacing } from '../lib/imageCapture';

export type ImageCaptureOverlayProps = {
  open: boolean;
  label: string;
  facing?: ImageCaptureFacing;
  onClose: () => void;
  onCaptured: (file: File) => void;
  onPickGallery: () => void;
  /** Native file input fallback when getUserMedia is unavailable. */
  onFallbackNativeCamera?: () => void;
};

export const ImageCaptureOverlay: React.FC<ImageCaptureOverlayProps> = ({
  open,
  label,
  facing: initialFacing = 'environment',
  onClose,
  onCaptured,
  onPickGallery,
  onFallbackNativeCamera,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<ImageCaptureFacing>(initialFacing);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);

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

  const handleShutter = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !ready || capturing) return;
    setCapturing(true);
    try {
      const file = await captureImageFileFromVideo(video);
      if (file) {
        stopStream();
        onCaptured(file);
      }
    } finally {
      setCapturing(false);
    }
  }, [ready, capturing, onCaptured, stopStream]);

  const handleFlip = useCallback(() => {
    setFacing(prev => (prev === 'environment' ? 'user' : 'environment'));
  }, []);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  const handleGallery = useCallback(() => {
    stopStream();
    onPickGallery();
  }, [onPickGallery, stopStream]);

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
              <button type="button" className="image-capture-overlay-text-btn" onClick={handleGallery}>
                Select from images
              </button>
              {onFallbackNativeCamera && (
                <button
                  type="button"
                  className="image-capture-overlay-text-btn"
                  onClick={() => {
                    stopStream();
                    onFallbackNativeCamera();
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
          <button
            type="button"
            className="image-capture-overlay-gallery-btn"
            onClick={handleGallery}
            aria-label="Select from images"
          >
            <ImageIcon size={22} />
          </button>

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
