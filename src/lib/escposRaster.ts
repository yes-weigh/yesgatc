/** ESC/POS raster helpers for 1-bit thermal output. */

const ESC = 0x1b;
const GS = 0x1d;

export type EscPosRaster = {
  widthBytes: number;
  height: number;
  data: Uint8Array;
};

export type EscPosPrintRotation = 0 | 90 | 180 | 270;

/** Rotate a canvas for rotated label stock (0/90/180/270 degrees clockwise). */
export function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: EscPosPrintRotation,
): HTMLCanvasElement {
  if (degrees === 0) return source;

  const rotated = document.createElement('canvas');
  const swap = degrees === 90 || degrees === 270;
  rotated.width = swap ? source.height : source.width;
  rotated.height = swap ? source.width : source.height;

  const ctx = rotated.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available for label rotation.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rotated.width, rotated.height);
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return rotated;
}

/** ESC V print direction (character/raster orientation hint on some label printers). */
function escPosPrintDirectionCommand(degrees: EscPosPrintRotation): Uint8Array | null {
  const directionByDegrees: Partial<Record<EscPosPrintRotation, number>> = {
    0: 0,
    90: 1,
    180: 2,
    270: 3,
  };
  const direction = directionByDegrees[degrees];
  if (direction === undefined) return null;
  return new Uint8Array([ESC, 0x56, direction]);
}

/** Pack RGBA canvas pixels into ESC/POS raster bits (black = 1). */
export function canvasToEscPosRaster(
  source: HTMLCanvasElement,
  targetWidthDots: number,
): EscPosRaster {
  const aspect = source.height / source.width;
  const targetHeightDots = Math.max(1, Math.round(targetWidthDots * aspect));

  const scaled = document.createElement('canvas');
  scaled.width = targetWidthDots;
  scaled.height = targetHeightDots;
  const ctx = scaled.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available for label rendering.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidthDots, targetHeightDots);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, targetWidthDots, targetHeightDots);

  const { data: rgba } = ctx.getImageData(0, 0, targetWidthDots, targetHeightDots);
  const widthBytes = Math.ceil(targetWidthDots / 8);
  const raster = new Uint8Array(widthBytes * targetHeightDots);

  for (let y = 0; y < targetHeightDots; y += 1) {
    for (let x = 0; x < targetWidthDots; x += 1) {
      const i = (y * targetWidthDots + x) * 4;
      const lum = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
      if (lum < 168) {
        const byteIndex = y * widthBytes + (x >> 3);
        raster[byteIndex] |= 0x80 >> (x & 7);
      }
    }
  }

  return { widthBytes, height: targetHeightDots, data: raster };
}

export type BuildEscPosLabelPayloadOptions = {
  /** Bitmap is pre-rotated; ESC V stays at normal (0) to avoid double rotation. */
  rotationDeg?: EscPosPrintRotation;
  /** Send ESC V orientation before raster (ignored when bitmap is pre-rotated). */
  escPosOrientation?: boolean;
};

/** Build ESC/POS command buffer: init, optional orientation, raster image, feed. */
export function buildEscPosLabelPayload(
  raster: EscPosRaster,
  options: BuildEscPosLabelPayloadOptions = {},
): Uint8Array {
  const { widthBytes, height, data } = raster;
  const rotationDeg = options.rotationDeg ?? 0;
  const useEscPosOrientation = options.escPosOrientation ?? false;
  const orientation = useEscPosOrientation ? escPosPrintDirectionCommand(rotationDeg) : null;

  const rasterHeader = new Uint8Array([
    GS,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);
  const init = new Uint8Array([ESC, 0x40]);
  const tail = new Uint8Array([ESC, 0x56, 0x00, 0x0a, 0x0a, 0x0a]);

  const parts: Uint8Array[] = [init];
  if (orientation) parts.push(orientation);
  parts.push(rasterHeader, Uint8Array.from(data), tail);

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
