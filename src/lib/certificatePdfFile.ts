import { getBlob, ref } from 'firebase/storage';
import { legacyStorage, storage } from '../firebase';
import { loadPdfJs } from './pdfJs';
import { storagePathFromDownloadUrl } from './storageImageUrl';

const PDF_FILE_CACHE_LIMIT = 6;
const pdfFileCache = new Map<string, File>();

export function certificatePdfFileName(record: { certificateNumber?: string }): string {
  const raw = record.certificateNumber?.trim() || 'certificate';
  return `${raw.replace(/[^\w.-]+/g, '_')}.pdf`;
}

export function canUseNativePdfFrame(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function revokeCertificatePdfUrl(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function pdfCacheKey(url: string, path: string, fileName: string): string {
  return `${path || url}|${fileName}`;
}

function rememberPdfFile(key: string, file: File): void {
  if (pdfFileCache.has(key)) pdfFileCache.delete(key);
  pdfFileCache.set(key, file);
  while (pdfFileCache.size > PDF_FILE_CACHE_LIMIT) {
    const oldest = pdfFileCache.keys().next().value;
    if (oldest == null) break;
    pdfFileCache.delete(oldest);
  }
}

async function blobFromStoragePath(path: string): Promise<Blob | null> {
  const trimmed = path.trim();
  if (!trimmed) return null;
  for (const backend of [storage, legacyStorage]) {
    try {
      return await getBlob(ref(backend, trimmed));
    } catch {
      /* try next bucket */
    }
  }
  return null;
}

function looksLikeHtml(blob: Blob): boolean {
  const type = blob.type.toLowerCase();
  return type.includes('html') || type.includes('text/');
}

async function blobFromHttp(url: string): Promise<Blob> {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`Could not load certificate PDF (${response.status}).`);
  return response.blob();
}

function mapFetchError(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error('Could not fetch PDF. Retry on a stronger network.');
  }
  return err instanceof Error ? err : new Error('Could not load certificate PDF.');
}

export async function fetchCertificatePdfFile(
  url: string,
  fileName: string,
  storagePath?: string | null,
): Promise<File> {
  const path = storagePath?.trim() || storagePathFromDownloadUrl(url) || '';
  const key = pdfCacheKey(url.trim(), path, fileName);
  const cached = pdfFileCache.get(key);
  if (cached) return cached;

  let blob: Blob | null = null;

  if (url.trim()) {
    try {
      blob = await blobFromHttp(url.trim());
    } catch {
      blob = null;
    }
  }

  if (!blob && path) blob = await blobFromStoragePath(path);

  if (!blob && url.trim()) {
    try {
      blob = await blobFromHttp(url.trim());
    } catch (err) {
      throw mapFetchError(err);
    }
  }

  if (!blob) throw new Error('Certificate PDF is not available.');
  if (looksLikeHtml(blob)) throw new Error('Certificate file is not a PDF.');

  const file = new File([blob], fileName, { type: 'application/pdf' });
  rememberPdfFile(key, file);
  return file;
}

export function downloadCertificatePdfFile(file: File): void {
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = file.name || 'certificate.pdf';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

function phoneRasterSettings() {
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
  const cssWidth = Math.min(window.innerWidth - 16, phone ? 640 : 900);
  return {
    cssWidth,
    pixelRatio: Math.min(window.devicePixelRatio || 1, phone ? 1.25 : 2),
    jpegQuality: phone ? 0.68 : 0.84,
  };
}

function canvasToJpegUrl(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Could not render certificate page.'));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/jpeg', quality);
  });
}

export type RenderCertificatePdfPageFn = (url: string, pageNumber: number, pageCount: number) => void;

export async function renderCertificatePdfPages(
  source: File | string,
  onPage?: RenderCertificatePdfPageFn,
): Promise<string[]> {
  const pdfjs = await loadPdfJs();
  const fromUrl = typeof source === 'string';
  const pdf = await pdfjs.getDocument(
    fromUrl
      ? {
          url: source,
          disableRange: false,
          disableStream: false,
          isEvalSupported: false,
        }
      : {
          data: await source.arrayBuffer(),
          disableRange: true,
          disableStream: true,
          isEvalSupported: false,
        },
  ).promise;

  const pages: string[] = [];
  const { cssWidth, pixelRatio, jpegQuality } = phoneRasterSettings();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = (cssWidth * pixelRatio) / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) continue;
    await page.render({ canvasContext: context, viewport, intent: 'display' }).promise;
    const pageUrl = await canvasToJpegUrl(canvas, jpegQuality);
    canvas.width = 0;
    canvas.height = 0;
    pages.push(pageUrl);
    onPage?.(pageUrl, pageNumber, pdf.numPages);
  }

  return pages;
}
