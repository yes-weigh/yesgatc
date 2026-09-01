import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { toCanvas } from 'html-to-image';
import { isNativeApp } from './nativeApp';

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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'));
    reader.readAsDataURL(blob);
  });
}

async function shareFileOnNative(file: File, title: string): Promise<void> {
  const base64 = await blobToBase64(file);
  const path = file.name.replace(/[^\w.-]+/g, '_');
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Cache,
  });
  const { uri } = await Filesystem.getUri({
    path,
    directory: Directory.Cache,
  });
  await Share.share({
    title,
    files: [uri],
    dialogTitle: title,
  });
}

/** Native phone share sheet with the image file. Download if share-with-files is unavailable. */
export async function shareElementImageOnPhone(options: {
  element: HTMLElement;
  fileName: string;
  title: string;
}): Promise<ShareVerificationReceiptResult> {
  const file = await captureVerificationReceiptImageFile(options.element, options.fileName);

  if (isNativeApp()) {
    await shareFileOnNative(file, options.title);
    return 'shared';
  }

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
