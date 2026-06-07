import { toCanvas } from 'html-to-image';
import { normalizePhone } from './contactFields';

export async function captureVerificationReceiptCanvas(
  element: HTMLElement,
): Promise<HTMLCanvasElement> {
  return toCanvas(element, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true,
  });
}

export async function captureVerificationReceiptImageFile(
  element: HTMLElement,
  fileName = `wallet-receipt-${Date.now()}.jpg`,
): Promise<File> {
  const canvas = await captureVerificationReceiptCanvas(element);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      result => {
        if (result) resolve(result);
        else reject(new Error('Could not create receipt image.'));
      },
      'image/jpeg',
      0.92,
    );
  });

  return new File([blob], fileName, { type: 'image/jpeg' });
}

function canShareReceiptImage(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

function openWhatsAppChat(phone?: string | null): void {
  const digits = phone ? normalizePhone(phone) : '';
  const url = digits.length === 10 ? `https://wa.me/91${digits}` : 'https://wa.me/';
  window.open(url, '_blank', 'noopener,noreferrer');
}

function downloadReceiptImage(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type ShareVerificationReceiptResult = 'shared' | 'downloaded';

/** Share wallet receipt preview as a JPEG — native share sheet or download + WhatsApp fallback. */
export async function shareVerificationReceiptOnWhatsApp(options: {
  element: HTMLElement;
  phone?: string | null;
}): Promise<ShareVerificationReceiptResult> {
  const file = await captureVerificationReceiptImageFile(options.element);

  if (canShareReceiptImage(file)) {
    await navigator.share({ files: [file], title: 'Wallet receipt' });
    return 'shared';
  }

  downloadReceiptImage(file);
  openWhatsAppChat(options.phone);
  return 'downloaded';
}

export function formatReceiptShareError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Share cancelled.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Could not share receipt image. Try again.';
}
