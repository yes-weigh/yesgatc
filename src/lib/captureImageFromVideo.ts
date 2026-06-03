import { drawPhotoCaptureStamp, type PhotoCaptureStamp } from './photoCaptureStamp';

export type CaptureImageOptions = {
  fileName?: string;
  stamp?: PhotoCaptureStamp | null;
};

/** Draw the current video frame to a JPEG file for upload. */
export async function captureImageFileFromVideo(
  video: HTMLVideoElement,
  fileNameOrOptions: string | CaptureImageOptions = `photo-${Date.now()}.jpg`,
): Promise<File | null> {
  const options =
    typeof fileNameOrOptions === 'string' ? { fileName: fileNameOrOptions } : fileNameOrOptions;
  const fileName = options.fileName ?? `photo-${Date.now()}.jpg`;

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);

  if (options.stamp) {
    await drawPhotoCaptureStamp(ctx, width, height, options.stamp);
  }

  return new Promise(resolve => {
    canvas.toBlob(
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
