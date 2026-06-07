/** ESC/POS raster helpers for 1-bit thermal output. */

const ESC = 0x1b;
const GS = 0x1d;

export type EscPosRaster = {
  widthBytes: number;
  height: number;
  data: Uint8Array;
};

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

/** Build ESC/POS command buffer: init, raster image, feed. */
export function buildEscPosLabelPayload(raster: EscPosRaster): Uint8Array {
  const { widthBytes, height, data } = raster;
  const header = new Uint8Array([
    ESC,
    0x40,
    GS,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);
  const tail = new Uint8Array([0x0a, 0x0a, 0x0a]);
  const out = new Uint8Array(header.length + data.length + tail.length);
  out.set(header, 0);
  out.set(data, header.length);
  out.set(tail, header.length + data.length);
  return out;
}
