import { loadPdfJs } from './pdfJs';

export function certificatePdfFileName(record: { certificateNumber?: string }): string {
  const raw = record.certificateNumber?.trim() || 'certificate';
  return `${raw.replace(/[^\w.-]+/g, '_')}.pdf`;
}

export async function fetchCertificatePdfFile(url: string, fileName: string): Promise<File> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error('Could not load certificate PDF.');
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'application/pdf' });
}

export async function renderCertificatePdfPages(file: File): Promise<string[]> {
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
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
