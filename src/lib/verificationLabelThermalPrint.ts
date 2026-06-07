import { toCanvas } from 'html-to-image';
import {
  isBluetoothEscposSupported,
  requestBluetoothEscposPrinter,
  sendEscposOverBluetooth,
} from './bluetoothEscposPrinter';
import { buildEscPosLabelPayload, canvasToEscPosRaster } from './escposRaster';
import { VERIFICATION_LABEL_STICKER } from './verificationLabel';

export function getVerificationLabelPrintWidthDots(): number {
  return VERIFICATION_LABEL_STICKER.widthMm * VERIFICATION_LABEL_STICKER.printDotsPerMm;
}

async function waitForLabelImages(element: HTMLElement): Promise<void> {
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map(
      img =>
        new Promise<void>((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Label logo failed to load.'));
        }),
    ),
  );
}

export async function captureVerificationLabelCanvas(
  element: HTMLElement,
): Promise<HTMLCanvasElement> {
  await waitForLabelImages(element);

  return toCanvas(element, {
    pixelRatio: 3,
    backgroundColor: '#ffffff',
    cacheBust: true,
  });
}

export async function printVerificationLabelToBluetooth(
  element: HTMLElement,
): Promise<{ deviceName: string }> {
  const canvas = await captureVerificationLabelCanvas(element);
  const raster = canvasToEscPosRaster(canvas, getVerificationLabelPrintWidthDots());
  const payload = buildEscPosLabelPayload(raster);
  const device = await requestBluetoothEscposPrinter();
  await sendEscposOverBluetooth(device, payload);
  return { deviceName: device.name || 'Bluetooth printer' };
}

export function getBluetoothPrintHelpText(): string {
  if (!isBluetoothEscposSupported()) {
    return 'Bluetooth printing needs Chrome on Android over HTTPS. Many ESC/POS printers use Bluetooth Classic only — BLE UART models work best.';
  }
  return 'Tap Print, choose your ESC/POS label printer, and wait for the sticker to feed. Use Chrome on Android with the PWA installed.';
}

export function formatBluetoothPrintError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') return 'Printer selection cancelled.';
    if (error.name === 'SecurityError') {
      return 'Bluetooth is blocked. Open the app over HTTPS in Chrome on Android.';
    }
    if (error.name === 'NetworkError') {
      return 'Lost connection to the printer. Check power and pairing, then try again.';
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Bluetooth print failed. Try again or use a BLE ESC/POS printer.';
}
