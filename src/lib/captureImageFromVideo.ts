import {
  drawPhotoCaptureStamp,
  stampForCapture,
  type PhotoCaptureStamp,
  type StampWeather,
} from './photoCaptureStamp';
import {
  exportCanvasAsJpeg,
  fitWithinMaxEdge,
  VERIFICATION_JPEG_QUALITY,
  VERIFICATION_MAX_EDGE,
} from './prepareImageForUpload';

export type CaptureImageOptions = {
  fileName?: string;
  stamp?: PhotoCaptureStamp | null;
  /** Longest-edge cap in px. Defaults to VERIFICATION_MAX_EDGE. */
  maxEdge?: number;
  /** JPEG quality 0–1. Defaults to VERIFICATION_JPEG_QUALITY. */
  quality?: number;
};

export { VERIFICATION_MAX_EDGE, VERIFICATION_JPEG_QUALITY };

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
  const maxEdge = options.maxEdge ?? VERIFICATION_MAX_EDGE;
  const quality = options.quality ?? VERIFICATION_JPEG_QUALITY;
  const { width, height } = fitWithinMaxEdge(canvas.width, canvas.height, maxEdge);

  const stamped = document.createElement('canvas');
  stamped.width = width;
  stamped.height = height;
  const ctx = stamped.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, width, height);

  if (options.stamp) {
    await drawPhotoCaptureStamp(ctx, width, height, options.stamp);
  }

  return exportCanvasAsJpeg(stamped, fileName, { maxEdge, quality });
}

/** Apply geo overlay to a frozen frame (background after camera closes). */
export async function produceStampedPhotoFromCanvas(
  frozen: HTMLCanvasElement,
  capturedAt: Date,
  prefetched: PhotoCaptureStamp | null,
  fileName?: string,
  weather?: StampWeather,
): Promise<File | null> {
  const base = prefetched
    ? { ...prefetched, capturedAt }
    : await stampForCapture(capturedAt, null);
  const stamp =
    base && weather
      ? {
          ...base,
          ambientTemperature: weather.ambientTemperature ?? base.ambientTemperature,
          relativeHumidity: weather.relativeHumidity ?? base.relativeHumidity,
        }
      : base;
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
