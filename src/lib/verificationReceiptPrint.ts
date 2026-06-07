import {
  clearRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
  resolveBluetoothEscposPrinter,
  sendEscposOverBluetooth,
  shouldRetryBluetoothPrinterWithPicker,
  type ResolveBluetoothEscposPrinterOptions,
} from './bluetoothEscposPrinter';
import type { VerificationReceiptData } from './verificationReceipt';
import { buildVerificationReceiptEscPosPayload } from './verificationReceiptEscpos';
import {
  formatBluetoothPrintError,
  getBluetoothPrintHelpText,
} from './verificationLabelThermalPrint';

export { formatBluetoothPrintError, getBluetoothPrintHelpText, isBluetoothEscposSupported };

export async function printVerificationReceiptToBluetooth(
  receipt: VerificationReceiptData,
  options: ResolveBluetoothEscposPrinterOptions = {},
): Promise<{ deviceName: string }> {
  const payload = buildVerificationReceiptEscPosPayload(receipt);

  let device = await resolveBluetoothEscposPrinter(options);
  try {
    await sendEscposOverBluetooth(device, payload);
  } catch (error) {
    if (!options.forcePicker && shouldRetryBluetoothPrinterWithPicker(error)) {
      clearRememberedBluetoothPrinter();
      device = await resolveBluetoothEscposPrinter({ forcePicker: true });
      await sendEscposOverBluetooth(device, payload);
    } else {
      throw error;
    }
  }

  return { deviceName: device.name || 'Bluetooth printer' };
}
