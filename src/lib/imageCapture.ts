export type ImageCaptureFacing = 'user' | 'environment';

/** Installed PWA or iOS home-screen web app. */
export function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Phone/tablet-style touch device (not desktop with mouse). */
export function isMobileTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return (coarsePointer && noHover) || (mobileUa && window.innerWidth <= 1024);
}

export function shouldUseMobileCameraCapture(): boolean {
  return isPwaStandalone() || isMobileTouchDevice();
}

export function acceptAllowsImageCapture(accept: string): boolean {
  const parts = accept.split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
  const hasImage = parts.some(
    part => part === 'image/*' || part.startsWith('image/'),
  );
  const hasNonImage = parts.some(part => {
    if (part === 'image/*' || part.startsWith('image/')) return false;
    return true;
  });
  return hasImage && !hasNonImage;
}

/**
 * When set on `<input type="file">`, mobile browsers and PWAs prefer the device camera.
 * Desktop browsers ignore `capture` and keep the normal file picker.
 */
export function getImageCaptureAttribute(
  accept: string,
  options?: { avatar?: boolean },
): ImageCaptureFacing | undefined {
  if (!acceptAllowsImageCapture(accept)) return undefined;
  if (!shouldUseMobileCameraCapture()) return undefined;
  return options?.avatar ? 'user' : 'environment';
}

/** `image/*` opens the camera more reliably on iOS when capture is enabled. */
export function fileInputAcceptForCapture(accept: string, capture?: ImageCaptureFacing): string {
  if (!capture) return accept;
  return 'image/*';
}

export function mobileCameraUploadLabel(defaultLabel: string, capture?: ImageCaptureFacing): string {
  if (!capture) return defaultLabel;
  if (/^upload/i.test(defaultLabel)) {
    return defaultLabel.replace(/^upload/i, 'Take photo');
  }
  return 'Take photo';
}
