/** Web Bluetooth transport for ESC/POS thermal printers (BLE UART profiles). */

const OPTIONAL_BLUETOOTH_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '49535343-fe7d-4ae0-bfa0-fcf8cc8dfb7',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
] as const;

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

export async function requestBluetoothEscposPrinter(): Promise<BluetoothDevice> {
  const bluetooth = navigator.bluetooth;
  if (!bluetooth) {
    throw new Error(
      'Web Bluetooth is not available. Use Chrome on Android over HTTPS, open the installed PWA, then try again.',
    );
  }

  return bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [...OPTIONAL_BLUETOOTH_SERVICES],
  });
}

export async function sendEscposOverBluetooth(
  device: BluetoothDevice,
  payload: Uint8Array,
): Promise<void> {
  if (!device.gatt) {
    throw new Error('Selected Bluetooth device does not expose GATT services.');
  }

  const server = await device.gatt.connect();
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
  } finally {
    if (device.gatt.connected) {
      device.gatt.disconnect();
    }
  }
}
