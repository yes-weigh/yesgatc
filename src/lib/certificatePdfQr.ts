import jsQR from 'jsqr';
import {
  certificatePdfFileName,
  fetchCertificatePdfFile,
} from './certificatePdfFile';
import { buildCertificateVerifyUrl, isEmaapCertificatePdfUrl } from './certificateVerifyUrl';
import { loadPdfJs } from './pdfJs';
import type { SiteCalibration } from '../types';

const qrCache = new Map<string, string | null>();

function stripUrlHash(url: string): string {
  const hash = url.indexOf('#');
  return hash >= 0 ? url.slice(0, hash) : url;
}

function asHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return stripUrlHash(trimmed);
}

function pickAnnotationUrl(annotation: Record<string, unknown>): string | null {
  for (const key of ['url', 'unsafeUrl', 'action']) {
    const url = asHttpUrl(annotation[key]);
    if (url) return url;
  }
  return null;
}

function decodeQr(image: ImageData): string | null {
  const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
  const payload = code?.data?.trim();
  return payload ? stripUrlHash(payload) : null;
}

function decodeQrRegions(canvas: HTMLCanvasElement): string | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const full = decodeQr(context.getImageData(0, 0, canvas.width, canvas.height));
  if (full) return full;

  const width = Math.floor(canvas.width * 0.42);
  const height = Math.floor(canvas.height * 0.38);
  const top = canvas.height - height;
  return decodeQr(context.getImageData(0, Math.max(0, top), width, height));
}

async function extractUrlFromPdfFile(file: File): Promise<string | null> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    disableRange: true,
    disableStream: true,
  }).promise;

  const pageOrder = [pdf.numPages, ...Array.from({ length: pdf.numPages - 1 }, (_, i) => i + 1)];
  const seen = new Set<number>();

  for (const pageNumber of pageOrder) {
    if (seen.has(pageNumber)) continue;
    seen.add(pageNumber);
    const page = await pdf.getPage(pageNumber);
    const annotations = (await page.getAnnotations()) as Record<string, unknown>[];
    const annotationUrls = annotations.map(pickAnnotationUrl).filter((url): url is string => Boolean(url));
    const emaapLink = annotationUrls.find(url => isEmaapCertificatePdfUrl(url));
    if (emaapLink) return emaapLink;
    if (annotationUrls[0]) return annotationUrls[0];

    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.4, 1400 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) continue;
    await page.render({ canvasContext: context, viewport }).promise;
    const decoded = decodeQrRegions(canvas);
    if (decoded) return decoded;
  }

  return null;
}

function certificatePdfSource(record: SiteCalibration): { url: string; path: string | null } | null {
  const url =
    record.certificatePdfUrl?.trim()
    || record.signedCertificatePdfUrl?.trim()
    || record.emaapCertificatePdfUrl?.trim()
    || '';
  const path = record.certificatePdfPath?.trim() || record.signedCertificatePdfPath?.trim() || null;
  if (!url && !path) return null;
  return { url, path };
}

/** Same QR payload as the certificate PDF the Certificate button opens. */
export async function resolveCertificatePdfQrUrl(record: SiteCalibration): Promise<string | null> {
  const cacheKey = [
    record.id,
    record.emaapCertificatePdfUrl ?? '',
    record.certificatePdfUrl ?? '',
    record.certificatePdfPath ?? '',
    record.signedCertificatePdfUrl ?? '',
  ].join('|');
  if (qrCache.has(cacheKey)) return qrCache.get(cacheKey) ?? null;

  const stored = buildCertificateVerifyUrl(record);
  const source = certificatePdfSource(record);
  let extracted: string | null = null;

  if (source) {
    try {
      const file = await fetchCertificatePdfFile(
        source.url,
        certificatePdfFileName(record),
        source.path,
      );
      extracted = await extractUrlFromPdfFile(file);
    } catch {
      extracted = null;
    }
  }

  const url = extracted || stored;
  qrCache.set(cacheKey, url);
  return url;
}
