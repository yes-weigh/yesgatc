const STORAGE_KEY = 'weighlab.verificationLabel.bluetoothPrinter';

export type RememberedBluetoothPrinter = {
  id: string;
  name: string;
};

export function getRememberedBluetoothPrinter(): RememberedBluetoothPrinter | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<RememberedBluetoothPrinter>;
    if (!parsed.id?.trim()) return null;

    return {
      id: parsed.id.trim(),
      name: parsed.name?.trim() || 'Bluetooth printer',
    };
  } catch {
    return null;
  }
}

export function rememberBluetoothPrinter(device: BluetoothDevice): void {
  if (typeof localStorage === 'undefined') return;

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      id: device.id,
      name: device.name?.trim() || 'Bluetooth printer',
    } satisfies RememberedBluetoothPrinter),
  );
}

export function clearRememberedBluetoothPrinter(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
