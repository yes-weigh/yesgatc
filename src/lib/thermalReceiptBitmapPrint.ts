import { toCanvas } from 'html-to-image';
import { buildEscPosBitmapPayload, canvasToEscPosRaster } from './escposRaster';

async function waitForReceiptAssets(element: HTMLElement): Promise<void> {
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map(
      img =>
        new Promise<void>((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Receipt image failed to load.'));
        }),
    ),
  );
}

export async function captureReceiptCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
  await waitForReceiptAssets(element);
  const previousShadow = element.style.boxShadow;
  element.style.boxShadow = 'none';
  try {
    return await toCanvas(element, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      cacheBust: true,
    });
  } finally {
    element.style.boxShadow = previousShadow;
  }
}

/** 58mm ESC/POS head is 384 dots. Matches the ugly text wrap on 80mm-width commands. */
export const THERMAL_RECEIPT_WIDTH_DOTS = 384;

export function receiptCanvasToEscPosPayload(
  canvas: HTMLCanvasElement,
  widthDots = THERMAL_RECEIPT_WIDTH_DOTS,
): Uint8Array {
  const raster = canvasToEscPosRaster(canvas, widthDots, { smooth: true, threshold: 152 });
  return buildEscPosBitmapPayload(raster, 3);
}
