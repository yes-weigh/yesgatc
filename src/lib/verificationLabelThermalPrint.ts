import { toCanvas } from 'html-to-image';
import {
  beginBluetoothPrinterSelection,
  clearRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
  sendEscposOverBluetooth,
  shouldRetryBluetoothPrinterWithPicker,
  type ResolveBluetoothEscposPrinterOptions,
} from './bluetoothEscposPrinter';
import {
  buildEscPosLabelPayload,
  canvasToEscPosRaster,
  rotateCanvas,
  type EscPosPrintRotation,
} from './escposRaster';
import { isNativeApp } from './nativeApp';
import { VERIFICATION_LABEL_STICKER } from './verificationLabel';

function labelWidthAcrossPrintHead(rotationDeg: EscPosPrintRotation): number {
  const { widthMm, heightMm } = VERIFICATION_LABEL_STICKER;
  return rotationDeg === 90 || rotationDeg === 270 ? heightMm : widthMm;
}

export function getVerificationLabelPrintWidthDots(
  rotationDeg: EscPosPrintRotation = VERIFICATION_LABEL_STICKER.printRotationDeg,
): number {
  return labelWidthAcrossPrintHead(rotationDeg) * VERIFICATION_LABEL_STICKER.printDotsPerMm;
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
  options: ResolveBluetoothEscposPrinterOptions & {
    device?: Promise<BluetoothDevice>;
  } = {},
): Promise<{ deviceName: string }> {
  const devicePromise = options.device ?? beginBluetoothPrinterSelection(options);
  const rotationDeg = VERIFICATION_LABEL_STICKER.printRotationDeg;
  const captured = await captureVerificationLabelCanvas(element);
  const canvas = rotateCanvas(captured, rotationDeg);
  const raster = canvasToEscPosRaster(canvas, getVerificationLabelPrintWidthDots(rotationDeg));
  const payload = buildEscPosLabelPayload(raster, { rotationDeg });

  let device = await devicePromise;
  try {
    await sendEscposOverBluetooth(device, payload);
  } catch (error) {
    if (!options.forcePicker && shouldRetryBluetoothPrinterWithPicker(error)) {
      clearRememberedBluetoothPrinter();
      device = await beginBluetoothPrinterSelection({ forcePicker: true });
      await sendEscposOverBluetooth(device, payload);
    } else {
      throw error;
    }
  }

  return { deviceName: device.name || 'Bluetooth printer' };
}

export function getBluetoothPrintHelpText(): string {
  if (isNativeApp()) {
    return 'Bluetooth printers are not available in the Android app (WebView has no Web Bluetooth). Print from Chrome on the phone, or share/save the document.';
  }
  if (!isBluetoothEscposSupported()) {
    return 'Bluetooth printing needs Chrome on Android over HTTPS. Many ESC/POS printers use Bluetooth Classic only — BLE UART models work best.';
  }
  return 'Tap Print to use your saved Bluetooth printer. The device picker appears only the first time, or when you tap Change printer.';
}

export function formatBluetoothPrintError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') {
      return 'Bluetooth list closed. Tap Print, then tap your thermal printer in the list and Pair.';
    }
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
