import { getBlob, ref } from 'firebase/storage';
import { legacyStorage, storage } from '../firebase';
import { loadPdfJs } from './pdfJs';
import { storagePathFromDownloadUrl } from './storageImageUrl';

export function certificatePdfFileName(record: { certificateNumber?: string }): string {
  const raw = record.certificateNumber?.trim() || 'certificate';
  return `${raw.replace(/[^\w.-]+/g, '_')}.pdf`;
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
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
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
  let blob: Blob | null = path ? await blobFromStoragePath(path) : null;

  if (!blob && url.trim()) {
    try {
      blob = await blobFromHttp(url.trim());
    } catch (err) {
      if (path) blob = await blobFromStoragePath(path);
      if (!blob) throw mapFetchError(err);
    }
  }

  if (!blob) throw new Error('Certificate PDF is not available.');
  if (looksLikeHtml(blob)) throw new Error('Certificate file is not a PDF.');

  return new File([blob], fileName, { type: 'application/pdf' });
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

export async function renderCertificatePdfPages(file: File): Promise<string[]> {
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({
    data,
    disableRange: true,
    disableStream: true,
  }).promise;
  const pages: string[] = [];
  const cssWidth = Math.min(window.innerWidth - 16, 900);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);

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
    await page.render({ canvasContext: context, viewport }).promise;
    pages.push(canvas.toDataURL('image/jpeg', 0.92));
  }

  return pages;
}
