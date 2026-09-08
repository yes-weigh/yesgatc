export type CompactWizardDevice = {
  localId: string;
  included: boolean;
  isNewDevice: boolean;
  productId: string;
  productName?: string;
  productSpecificationId?: string;
  serialNumber: string;
  sealIdentificationNumber: string;
};

export type ProductStepCatalogueItem = {
  id: string;
  specifications?: readonly unknown[];
};

/** Compact OV/RV wizard is one instrument. Keep the row the product UI can edit. */
export function compactWizardWorkingDevices<T extends CompactWizardDevice>(
  devices: T[],
): T[] {
  const included = devices.filter(row => row.included);
  const working =
    included.find(row => row.productId.trim()) ??
    included[0] ??
    devices[0];
  if (!working) return [];
  return [{ ...working, included: true }];
}

function applyLockedSerial<T extends CompactWizardDevice>(devices: T[], lockedSerial: string): T[] {
  const serial = lockedSerial.trim();
  if (!serial || devices.length === 0) return devices;
  if (devices.some(row => row.serialNumber.trim() === serial)) return devices;
  return devices.map((row, index) =>
    index === 0 ? { ...row, serialNumber: serial } : row,
  );
}

/** Customer pick for a new job. Compact = one working row; never leftover empty seats. */
export function devicesForVerificationCustomerSelect<T extends CompactWizardDevice>(options: {
  compact: boolean;
  lockedSerial: string;
  currentDevices: T[];
  customerRows: T[];
  createEmpty: () => T;
}): T[] {
  const { compact, lockedSerial, currentDevices, customerRows, createEmpty } = options;
  const seed = currentDevices.find(row => row.isNewDevice) ?? currentDevices[0];
  const locked = lockedSerial.trim();

  if (compact) {
    const row = seed
      ? { ...seed, ...(locked ? { serialNumber: locked } : {}) }
      : { ...createEmpty(), serialNumber: locked };
    const next = locked ? applyLockedSerial([row], locked) : [row];
    return compactWizardWorkingDevices(next);
  }

  if (locked) {
    return applyLockedSerial(
      [
        seed
          ? { ...seed, serialNumber: locked }
          : { ...createEmpty(), serialNumber: locked },
      ],
      locked,
    );
  }

  return [...customerRows, ...currentDevices.filter(row => row.isNewDevice)];
}

function catalogueHasMultipleSpecs(product: ProductStepCatalogueItem | null | undefined): boolean {
  return (product?.specifications?.length ?? 0) > 1;
}

export function productStepRowBlockReason(
  row: CompactWizardDevice,
  index: number,
  products?: readonly ProductStepCatalogueItem[],
): string | null {
  const label = `Device ${index + 1}`;
  if (!row.productId.trim()) return `${label}: select a product.`;
  const product = products?.find(item => item.id === row.productId) ?? null;
  if (catalogueHasMultipleSpecs(product) && !row.productSpecificationId?.trim()) {
    return `${label}: select a capacity specification.`;
  }
  if (!row.sealIdentificationNumber.trim()) {
    return `${label}: seal identification number is required.`;
  }
  return null;
}

/** Product-step Serial enable. Compact jobs only check the first included row. */
export function productStepBlockReason(
  devices: CompactWizardDevice[],
  options?: { compact?: boolean; products?: readonly ProductStepCatalogueItem[] },
): string | null {
  const included = devices
    .map((row, index) => ({ row, index }))
    .filter(entry => entry.row.included);
  if (included.length === 0) return 'Add at least one instrument.';

  const rows = options?.compact ? included.slice(0, 1) : included;
  for (const { row, index } of rows) {
    const reason = productStepRowBlockReason(row, index, options?.products);
    if (reason) return reason;
  }
  return null;
}
