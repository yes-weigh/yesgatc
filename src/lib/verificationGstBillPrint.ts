import {
  clearRememberedBluetoothPrinter,
  isBluetoothEscposSupported,
  resolveBluetoothEscposPrinter,
  sendEscposOverBluetooth,
  shouldRetryBluetoothPrinterWithPicker,
  type ResolveBluetoothEscposPrinterOptions,
} from './bluetoothEscposPrinter';
import type { VerificationGstBillData } from './verificationGstBill';
import { buildVerificationGstBillEscPosPayload } from './verificationGstBillEscpos';
import {
  formatBluetoothPrintError,
  getBluetoothPrintHelpText,
} from './verificationLabelThermalPrint';

export { formatBluetoothPrintError, getBluetoothPrintHelpText, isBluetoothEscposSupported };

export async function printVerificationGstBillToBluetooth(
  bill: VerificationGstBillData,
  options: ResolveBluetoothEscposPrinterOptions = {},
): Promise<{ deviceName: string }> {
  const payload = buildVerificationGstBillEscPosPayload(bill);

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
