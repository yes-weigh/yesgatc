export const PDF_SIGNER_SCALE_DEFAULT = 1;
export const PDF_SIGNER_SCALE_MIN = 0.4;
export const PDF_SIGNER_SCALE_MAX = 2.4;
export const PDF_SIGNER_SCALE_STEP = 0.1;
export const PDF_SIGNER_NUDGE = 3;
export const PDF_SIGNER_X_DEFAULT = 50;
export const PDF_SIGNER_Y_DEFAULT = 50;

export type PdfSignerSignLayout = {
  pdfSignerSignScale: number;
  pdfSignerSignX: number;
  pdfSignerSignY: number;
};

export function clampPdfSignerScale(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return PDF_SIGNER_SCALE_DEFAULT;
  return Math.min(PDF_SIGNER_SCALE_MAX, Math.max(PDF_SIGNER_SCALE_MIN, Math.round(n * 10) / 10));
}

export function clampPdfSignerPercent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return PDF_SIGNER_X_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

export function pdfSignerSignLayoutFromUser(
  data: Partial<PdfSignerSignLayout> | undefined,
): PdfSignerSignLayout {
  return {
    pdfSignerSignScale: clampPdfSignerScale(data?.pdfSignerSignScale),
    pdfSignerSignX: clampPdfSignerPercent(data?.pdfSignerSignX ?? PDF_SIGNER_X_DEFAULT),
    pdfSignerSignY: clampPdfSignerPercent(data?.pdfSignerSignY ?? PDF_SIGNER_Y_DEFAULT),
  };
}
