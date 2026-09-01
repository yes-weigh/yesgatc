import {
  clearRememberedBluetoothPrinter as clearStoredBluetoothPrinter,
  getRememberedBluetoothPrinter,
  rememberBluetoothPrinter,
} from './bluetoothPrinterStorage';

/** Web Bluetooth transport for ESC/POS thermal printers (BLE UART profiles). */

const BLUETOOTH_SERVICE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Known BLE UART / ESC/POS service UUIDs (must be lowercase 128-bit UUIDs). */
const OPTIONAL_BLUETOOTH_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff01-0000-1000-8000-00805f9b34fb',
] as const;

function getOptionalBluetoothServices(): string[] {
  return OPTIONAL_BLUETOOTH_SERVICES.filter(uuid => BLUETOOTH_SERVICE_UUID.test(uuid));
}

const CHUNK_SIZE = 512;
const CHUNK_DELAY_MS = 12;

export function isBluetoothEscposSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function toWriteBuffer(chunk: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(chunk);
}

async function findWritableCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    for (const characteristic of characteristics) {
      if (
        characteristic.properties.write
        || characteristic.properties.writeWithoutResponse
      ) {
        return characteristic;
      }
    }
  }
  throw new Error(
    'No writable Bluetooth characteristic found on this printer. Try another device or check it is powered on.',
  );
}

function getBluetoothApi(): Bluetooth {
  const bluetooth = navigator.bluetooth;
  if (!bluetooth) {
    throw new Error(
      'Web Bluetooth is not available. Use Chrome on Android over HTTPS, open the installed PWA, then try again.',
    );
  }
  return bluetooth;
}

async function findGrantedBluetoothPrinter(deviceId: string): Promise<BluetoothDevice | null> {
  const bluetooth = getBluetoothApi();
  if (typeof bluetooth.getDevices !== 'function') return null;

  const grantedDevices = await bluetooth.getDevices();
  const device = grantedDevices.find(entry => entry.id === deviceId);
  return device?.gatt ? device : null;
}

let sessionPrinter: BluetoothDevice | null = null;

function cacheSessionPrinter(device: BluetoothDevice): void {
  sessionPrinter = device;
  rememberBluetoothPrinter(device);
}

export type ResolveBluetoothEscposPrinterOptions = {
  /** Show the system device picker even when a remembered printer exists. */
  forcePicker?: boolean;
};

async function ensureGattConnected(device: BluetoothDevice): Promise<void> {
  if (!device.gatt) {
    throw new Error('Selected Bluetooth device does not expose GATT services.');
  }
  if (device.gatt.connected) return;

  try {
    await device.gatt.connect();
    return;
  } catch {
    /* watch advertisements, then connect */
  }

  if (typeof device.watchAdvertisements !== 'function') {
    await device.gatt.connect();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      device.removeEventListener('advertisementreceived', onAdvertisement);
      reject(new Error('Printer not in range. Turn it on, then tap Print.'));
    }, 8000);

    const onAdvertisement = () => {
      window.clearTimeout(timeoutId);
      device.removeEventListener('advertisementreceived', onAdvertisement);
      void device.gatt
        ?.connect()
        .then(() => resolve())
        .catch(reject);
    };

    device.addEventListener('advertisementreceived', onAdvertisement);
    void device.watchAdvertisements().catch(err => {
      window.clearTimeout(timeoutId);
      device.removeEventListener('advertisementreceived', onAdvertisement);
      reject(err);
    });
  });
}

function requestPrinterFromChooser(): Promise<BluetoothDevice> {
  return getBluetoothApi()
    .requestDevice({
      acceptAllDevices: true,
      optionalServices: getOptionalBluetoothServices(),
    })
    .then(device => {
      cacheSessionPrinter(device);
      return device;
    });
}

/** Reconnect a previously granted printer. Safe to call without a click. */
export async function warmupRememberedBluetoothPrinter(): Promise<BluetoothDevice | null> {
  if (sessionPrinter?.gatt) return sessionPrinter;
  const remembered = getRememberedBluetoothPrinter();
  if (!remembered) return null;
  const granted = await findGrantedBluetoothPrinter(remembered.id);
  if (!granted) return null;
  cacheSessionPrinter(granted);
  return granted;
}

/**
 * Start printer resolve in the same turn as a click.
 * Must run before any await — Chrome drops the Bluetooth chooser otherwise.
 */
export function beginBluetoothPrinterSelection(
  options: ResolveBluetoothEscposPrinterOptions = {},
): Promise<BluetoothDevice> {
  if (!options.forcePicker && sessionPrinter?.gatt) {
    return Promise.resolve(sessionPrinter);
  }

  if (options.forcePicker) {
    sessionPrinter = null;
  }

  return requestPrinterFromChooser();
}

/** Reuse the last granted printer, or prompt once and remember the choice. */
export async function resolveBluetoothEscposPrinter(
  options: ResolveBluetoothEscposPrinterOptions = {},
): Promise<BluetoothDevice> {
  if (!options.forcePicker && sessionPrinter?.gatt) {
    return sessionPrinter;
  }
  if (!options.forcePicker) {
    const warmed = await warmupRememberedBluetoothPrinter();
    if (warmed) return warmed;
  }
  return beginBluetoothPrinterSelection(options);
}

/** @deprecated Use resolveBluetoothEscposPrinter instead. */
export async function requestBluetoothEscposPrinter(): Promise<BluetoothDevice> {
  return resolveBluetoothEscposPrinter();
}

export function shouldRetryBluetoothPrinterWithPicker(error: unknown): boolean {
  if (error instanceof Error) {
    return /writable bluetooth characteristic|does not expose gatt/i.test(error.message);
  }
  return false;
}

export { getRememberedBluetoothPrinter };

export function clearRememberedBluetoothPrinter(): void {
  sessionPrinter = null;
  clearStoredBluetoothPrinter();
}

export async function sendEscposOverBluetooth(
  device: BluetoothDevice,
  payload: Uint8Array,
): Promise<void> {
  if (!device.gatt) {
    throw new Error('Selected Bluetooth device does not expose GATT services.');
  }

  cacheSessionPrinter(device);
  await ensureGattConnected(device);
  const server = device.gatt;
  if (!server.connected) {
    throw new Error('Could not connect to the printer. Turn it on and try again.');
  }

  try {
    const characteristic = await findWritableCharacteristic(server);
    for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE) {
      const chunk = payload.subarray(offset, offset + CHUNK_SIZE);
      const buffer = toWriteBuffer(chunk);
      if (characteristic.properties.write) {
        await characteristic.writeValueWithResponse(buffer);
      } else {
        await characteristic.writeValueWithoutResponse(buffer);
      }
      if (offset + CHUNK_SIZE < payload.length) {
        await sleep(CHUNK_DELAY_MS);
      }
    }
    await sleep(80);
  } finally {
    if (device.gatt.connected) {
      device.gatt.disconnect();
    }
  }
}
