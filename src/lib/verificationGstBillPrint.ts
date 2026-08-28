import {
  beginBluetoothPrinterSelection,
  clearRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
  sendEscposOverBluetooth,
  shouldRetryBluetoothPrinterWithPicker,
  type ResolveBluetoothEscposPrinterOptions,
} from './bluetoothEscposPrinter';
import {
  captureReceiptCanvas,
  receiptCanvasToEscPosPayload,
  THERMAL_RECEIPT_WIDTH_DOTS,
} from './thermalReceiptBitmapPrint';
import {
  formatBluetoothPrintError,
  getBluetoothPrintHelpText,
} from './verificationLabelThermalPrint';
import { VERIFICATION_GST_BILL_RECEIPT } from './verificationGstBill';

export { formatBluetoothPrintError, getBluetoothPrintHelpText, isBluetoothEscposSupported };

export async function printVerificationGstBillToBluetooth(
  element: HTMLElement,
  options: ResolveBluetoothEscposPrinterOptions & {
    device?: Promise<BluetoothDevice>;
  } = {},
): Promise<{ deviceName: string }> {
  const devicePromise = options.device ?? beginBluetoothPrinterSelection(options);
  const canvas = await captureReceiptCanvas(element);
  const payload = receiptCanvasToEscPosPayload(
    canvas,
    VERIFICATION_GST_BILL_RECEIPT.printWidthDots ?? THERMAL_RECEIPT_WIDTH_DOTS,
  );

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
