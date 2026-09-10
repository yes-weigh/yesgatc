import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import {
  matchAllottedSerial,
  mergeSerialPlateFields,
  type SerialPlateFields,
} from './parseSerialPlateText';

const FUNCTIONS_REGION = 'us-central1';

export type SerialPlateRead = SerialPlateFields & {
  allottedMatch: string | null;
  source: 'gemini' | 'none';
};

function jpegFromCanvas(canvas: HTMLCanvasElement, quality = 0.72): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not encode plate photo'))),
      'image/jpeg',
      quality,
    );
  });
}

async function fileToJpegBase64(file: File, maxEdge = 1600): Promise<{ base64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not read plate photo');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await jpegFromCanvas(canvas);
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mimeType: 'image/jpeg' };
}

async function readViaGemini(file: File): Promise<SerialPlateFields | null> {
  const { base64, mimeType } = await fileToJpegBase64(file);
  const fn = httpsCallable<
    { imageBase64: string; mimeType: string },
    Partial<SerialPlateFields> & { rawText?: string }
  >(getFunctions(app, FUNCTIONS_REGION), 'readSerialPlate');
  const result = await fn({ imageBase64: base64, mimeType });
  const data = result.data ?? {};
  return mergeSerialPlateFields(data, data.rawText || '');
}

export async function readSerialPlate(
  file: File,
  allottedSerials: string[],
): Promise<SerialPlateRead> {
  let fields: SerialPlateFields | null = null;
  let source: SerialPlateRead['source'] = 'none';
  try {
    fields = await readViaGemini(file);
    if (fields && (fields.serialNumber || fields.rawText)) source = 'gemini';
  } catch {
    fields = null;
  }
  const resolved = fields ?? mergeSerialPlateFields(null, '');
  const allottedMatch = matchAllottedSerial(
    resolved.serialNumber,
    resolved.rawText,
    allottedSerials,
  );
  return { ...resolved, allottedMatch, source };
}
