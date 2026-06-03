import {
  drawPhotoCaptureStamp,
  stampForCapture,
  type PhotoCaptureStamp,
} from './photoCaptureStamp';

export type CaptureImageOptions = {
  fileName?: string;
  stamp?: PhotoCaptureStamp | null;
};

/** Snapshot the current video frame immediately (call on shutter — before any async work). */
export function freezeVideoFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}

/** Apply stamp and export a frozen canvas to JPEG. */
export async function captureCanvasToJpegFile(
  canvas: HTMLCanvasElement,
  options: CaptureImageOptions = {},
): Promise<File | null> {
  const fileName = options.fileName ?? `photo-${Date.now()}.jpg`;
  const width = canvas.width;
  const height = canvas.height;

  const stamped = document.createElement('canvas');
  stamped.width = width;
  stamped.height = height;
  const ctx = stamped.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0);

  if (options.stamp) {
    await drawPhotoCaptureStamp(ctx, width, height, options.stamp);
  }

  return new Promise(resolve => {
    stamped.toBlob(
      blob => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() }));
      },
      'image/jpeg',
      0.9,
    );
  });
}

/** Apply geo overlay to a frozen frame (background after camera closes). */
export async function produceStampedPhotoFromCanvas(
  frozen: HTMLCanvasElement,
  capturedAt: Date,
  prefetched: PhotoCaptureStamp | null,
  fileName?: string,
): Promise<File | null> {
  const stamp = prefetched
    ? { ...prefetched, capturedAt }
    : await stampForCapture(capturedAt, null);
  return captureCanvasToJpegFile(frozen, {
    fileName: fileName ?? `photo-${Date.now()}.jpg`,
    stamp: stamp ?? undefined,
  });
}

/** Draw the current video frame to a JPEG file for upload. */
export async function captureImageFileFromVideo(
  video: HTMLVideoElement,
  fileNameOrOptions: string | CaptureImageOptions = `photo-${Date.now()}.jpg`,
): Promise<File | null> {
  const options =
    typeof fileNameOrOptions === 'string' ? { fileName: fileNameOrOptions } : fileNameOrOptions;
  const frozen = freezeVideoFrame(video);
  if (!frozen) return null;
  return captureCanvasToJpegFile(frozen, options);
}
