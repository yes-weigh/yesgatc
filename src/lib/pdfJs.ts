type PdfJsModule = typeof import('pdfjs-dist');

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

export async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfJsModulePromise;
}

export function prefetchPdfJs(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    void loadPdfJs();
  }, 600);
}
