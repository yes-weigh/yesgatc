import { captureCanvasToJpegFile } from './captureImageFromVideo';
import { drawPhotoCaptureStamp, type PhotoCaptureStamp } from './photoCaptureStamp';

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

/** Apply the same on-photo geo overlay used by the in-app camera (desktop file upload). */
export async function stampVerificationImageFile(
  file: File,
  stamp: PhotoCaptureStamp,
): Promise<File> {
  const img = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(img, 0, 0);
  await drawPhotoCaptureStamp(ctx, canvas.width, canvas.height, stamp);

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  const stamped = await captureCanvasToJpegFile(canvas, {
    fileName: `${baseName}.jpg`,
  });
  if (!stamped) throw new Error('Could not export stamped image');
  return stamped;
}
