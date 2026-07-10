/** Longest-edge cap — field photos do not need full sensor resolution. */
export const VERIFICATION_MAX_EDGE = 2000;
export const VERIFICATION_JPEG_QUALITY = 0.75;

const COMPRESSIBLE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function fitWithinMaxEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

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

export async function exportCanvasAsJpeg(
  canvas: HTMLCanvasElement,
  fileName: string,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<File | null> {
  const maxEdge = options.maxEdge ?? VERIFICATION_MAX_EDGE;
  const quality = options.quality ?? VERIFICATION_JPEG_QUALITY;
  const { width, height } = fitWithinMaxEdge(canvas.width, canvas.height, maxEdge);

  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const ctx = output.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, width, height);

  return new Promise(resolve => {
    output.toBlob(
      blob => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() }));
      },
      'image/jpeg',
      quality,
    );
  });
}

/** Downscale and re-encode camera/gallery picks before Storage upload. */
export async function prepareImageForUpload(
  file: File,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) return file;

  const img = await loadImageFromFile(file);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  if (!naturalW || !naturalH) return file;

  const maxEdge = options.maxEdge ?? VERIFICATION_MAX_EDGE;
  const { width, height } = fitWithinMaxEdge(naturalW, naturalH, maxEdge);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  const baseName = file.name.replace(/\.[^.]+$/i, '') || 'photo';
  const compressed = await exportCanvasAsJpeg(canvas, `${baseName}.jpg`, options);
  return compressed ?? file;
}
