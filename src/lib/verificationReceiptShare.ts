import { toCanvas } from 'html-to-image';

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

function downloadReceiptImage(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type ShareVerificationReceiptResult = 'shared' | 'downloaded';

/** Native phone share sheet with the image file. Download if share-with-files is unavailable. */
export async function shareElementImageOnPhone(options: {
  element: HTMLElement;
  fileName: string;
  title: string;
}): Promise<ShareVerificationReceiptResult> {
  const file = await captureVerificationReceiptImageFile(options.element, options.fileName);
  const files = [file];
  const canShareFiles =
    typeof navigator.share === 'function'
    && (typeof navigator.canShare !== 'function' || navigator.canShare({ files }));

  if (canShareFiles) {
    await navigator.share({ files, title: options.title });
    return 'shared';
  }

  downloadReceiptImage(file);
  return 'downloaded';
}

export function formatReceiptShareError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Share cancelled.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Could not share receipt image. Try again.';
}
