import type { Customer, CustomerDevice, JobType, Product, SiteCalibration, VerificationLocation } from '../types';
import {
  buildRcDirectVerificationMeta,
  productSnapshotFromProduct,
} from './verificationRequest';
import type { ProductFileMeta } from './productApprovalUpload';
import {
  deviceVerificationImagesFromRows,
  emptyDeviceVerificationImagesState,
  validateDeviceVerificationImages,
  verificationImagesFromRecord,
  type DeviceVerificationImagesState,
} from './verificationDeviceImages';

export type { DeviceVerificationImagesState, DeviceImageSlotState, VerificationImageKind } from './verificationDeviceImages';

export type SiteCalibrationFormValues = {
  verificationType: JobType | '';
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  serialNumber: string;
  maximumPermissibleError: string;
  ambientTemperature: string;
  relativeHumidity: string;
  sealIdentificationNumber: string;
};

export type VerificationDeviceRowValues = {
  localId: string;
  deviceId: string;
  isNewDevice: boolean;
  included: boolean;
  productId: string;
  productName: string;
  serialNumber: string;
  maximumPermissibleError: string;
  sealIdentificationNumber: string;
  verificationLocation: VerificationLocation | '';
};

export type VerificationSessionValues = {
  verificationType: JobType | '';
  customerId: string;
  customerName: string;
  ambientTemperature: string;
  relativeHumidity: string;
  devices: VerificationDeviceRowValues[];
};

export type DeviceScaleImageState = import('./verificationDeviceImages').DeviceImageSlotState;

export const EMPTY_SITE_CALIBRATION_FORM: SiteCalibrationFormValues = {
  verificationType: 'OV',
  customerId: '',
  customerName: '',
  productId: '',
  productName: '',
  serialNumber: '',
  maximumPermissibleError: '',
  ambientTemperature: '',
  relativeHumidity: '',
  sealIdentificationNumber: '',
};

export const EMPTY_VERIFICATION_SESSION: VerificationSessionValues = {
  verificationType: 'OV',
  customerId: '',
  customerName: '',
  ambientTemperature: '',
  relativeHumidity: '',
  devices: [],
};

export function emptyDeviceScaleImageState(): DeviceScaleImageState {
  return emptyDeviceVerificationImagesState().scale;
}

export function deviceImageStatesFromRows(
  rows: VerificationDeviceRowValues[],
): Record<string, DeviceVerificationImagesState> {
  return deviceVerificationImagesFromRows(rows);
}

export const VERIFICATION_LOCATION_OPTIONS: { value: VerificationLocation; label: string }[] = [
  { value: 'in_situ', label: 'In situ' },
  { value: 'in_premises', label: 'In the premises' },
];

export function verificationLocationLabel(location: VerificationLocation | '' | undefined): string {
  if (location === 'in_situ') return 'In situ';
  if (location === 'in_premises') return 'In the premises';
  return '—';
}

export function createEmptyVerificationDeviceRow(): VerificationDeviceRowValues {
  return {
    localId: crypto.randomUUID(),
    deviceId: '',
    isNewDevice: true,
    included: true,
    productId: '',
    productName: '',
    serialNumber: '',
    maximumPermissibleError: '',
    sealIdentificationNumber: '',
    verificationLocation: 'in_situ',
  };
}

export function verificationTypeLabel(type: JobType | ''): string {
  if (type === 'OV') return 'Original Verification';
  if (type === 'RV') return 'Re-verification';
  return '—';
}

export function mpeStringFromProduct(product: { maximumPermissibleError?: number } | null | undefined): string {
  const value = product?.maximumPermissibleError;
  if (value === undefined || value === null || !Number.isFinite(value)) return '';
  return String(value);
}

export function deviceRowFromCustomerDevice(
  device: CustomerDevice,
  products: Product[],
): VerificationDeviceRowValues {
  const product = products.find(p => p.id === device.productId) ?? null;
  return {
    localId: device.id,
    deviceId: device.id,
    isNewDevice: false,
    included: true,
    productId: device.productId || '',
    productName: device.productName,
    serialNumber: device.serialNumber,
    maximumPermissibleError: mpeStringFromProduct(product),
    sealIdentificationNumber: '',
    verificationLocation: 'in_situ',
  };
}

export function deviceRowsFromCustomer(
  customer: Customer | null | undefined,
  products: Product[],
): VerificationDeviceRowValues[] {
  if (!customer?.devices?.length) return [];
  return customer.devices.map(device => deviceRowFromCustomerDevice(device, products));
}

/** Keep verification row state when customer devices are updated inline. */
export function syncVerificationDevicesAfterCustomerUpdate(
  current: VerificationDeviceRowValues[],
  customer: Customer,
  products: Product[],
): VerificationDeviceRowValues[] {
  const registered = deviceRowsFromCustomer(customer, products);
  const newDeviceRows = current.filter(row => row.isNewDevice);

  const merged = registered.map(reg => {
    const existing = current.find(row => !row.isNewDevice && row.deviceId === reg.deviceId);
    if (!existing) return reg;
    return {
      ...reg,
      localId: existing.localId,
      included: existing.included,
      sealIdentificationNumber: existing.sealIdentificationNumber,
      verificationLocation: existing.verificationLocation,
    };
  });

  return [...merged, ...newDeviceRows];
}

export function verificationSessionFromRecord(
  record: SiteCalibration,
): VerificationSessionValues {
  return {
    verificationType: record.verificationType,
    customerId: record.customerId || '',
    customerName: record.customerName || '',
    ambientTemperature: record.ambientTemperature || '',
    relativeHumidity: record.relativeHumidity || '',
    devices: [
      {
        localId: record.deviceId || record.id,
        deviceId: record.deviceId || '',
        isNewDevice: false,
        included: true,
        productId: record.productId || '',
        productName: record.productName || '',
        serialNumber: record.serialNumber || '',
        maximumPermissibleError:
          record.maximumPermissibleError !== undefined && record.maximumPermissibleError !== null
            ? String(record.maximumPermissibleError)
            : '',
        sealIdentificationNumber: record.sealIdentificationNumber || '',
        verificationLocation: record.verificationLocation || '',
      },
    ],
  };
}

export function siteCalibrationFormFromRecord(record: SiteCalibration): SiteCalibrationFormValues {
  const session = verificationSessionFromRecord(record);
  const row = session.devices[0];
  return {
    verificationType: session.verificationType,
    customerId: session.customerId,
    customerName: session.customerName,
    productId: row?.productId || '',
    productName: row?.productName || '',
    serialNumber: row?.serialNumber || '',
    maximumPermissibleError: row?.maximumPermissibleError || '',
    ambientTemperature: session.ambientTemperature,
    relativeHumidity: session.relativeHumidity,
    sealIdentificationNumber: row?.sealIdentificationNumber || '',
  };
}

export function buildSiteCalibrationFromRow(
  session: VerificationSessionValues,
  row: VerificationDeviceRowValues,
  options?: { product?: Product | null },
): Omit<
  SiteCalibration,
  'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt' | 'status' | 'submittedAt' | 'approvedAt'
> {
  const fields: Omit<
    SiteCalibration,
    'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt' | 'status' | 'submittedAt' | 'approvedAt'
  > = {
    verificationType: session.verificationType as JobType,
    customerId: session.customerId.trim(),
    customerName: session.customerName.trim(),
    productId: row.productId.trim(),
    productName: row.productName.trim(),
    serialNumber: row.serialNumber.trim(),
    maximumPermissibleError: Number(row.maximumPermissibleError.trim()) || 0,
    ambientTemperature: session.ambientTemperature.trim(),
    relativeHumidity: session.relativeHumidity.trim(),
    sealIdentificationNumber: row.sealIdentificationNumber.trim(),
    verificationLocation: row.verificationLocation as VerificationLocation,
    ...productSnapshotFromProduct(options?.product),
  };
  if (row.deviceId.trim()) fields.deviceId = row.deviceId.trim();
  return fields;
}

export function buildNewSiteCalibrationRecord(
  session: VerificationSessionValues,
  row: VerificationDeviceRowValues,
  product?: Product | null,
): Omit<SiteCalibration, 'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt'> {
  return {
    ...buildSiteCalibrationFromRow(session, row, { product }),
    ...buildRcDirectVerificationMeta(),
  };
}

export function buildSiteCalibrationFields(
  values: SiteCalibrationFormValues,
): Omit<
  SiteCalibration,
  'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt'
> {
  return buildSiteCalibrationFromRow(
    {
      verificationType: values.verificationType,
      customerId: values.customerId,
      customerName: values.customerName,
      ambientTemperature: values.ambientTemperature,
      relativeHumidity: values.relativeHumidity,
      devices: [],
    },
    {
      localId: '',
      deviceId: '',
      isNewDevice: false,
      included: true,
      productId: values.productId,
      productName: values.productName,
      serialNumber: values.serialNumber,
      maximumPermissibleError: values.maximumPermissibleError,
      sealIdentificationNumber: values.sealIdentificationNumber,
      verificationLocation: 'in_situ',
    },
  );
}

function validateSessionHeader(session: VerificationSessionValues): string | null {
  if (session.verificationType !== 'OV' && session.verificationType !== 'RV') {
    return 'Select Original Verification or Re-verification.';
  }
  if (!session.customerId.trim()) return 'Select a customer.';

  if (!session.ambientTemperature.trim()) return 'Ambient temperature is required.';
  if (!session.relativeHumidity.trim()) return 'Relative humidity is required.';

  const temp = Number(session.ambientTemperature.trim());
  if (Number.isNaN(temp)) return 'Ambient temperature must be a number.';

  const humidity = Number(session.relativeHumidity.trim());
  if (Number.isNaN(humidity) || humidity < 0 || humidity > 100) {
    return 'Relative humidity must be a number between 0 and 100.';
  }

  return null;
}

function validateOptionalSessionFormats(session: VerificationSessionValues): string | null {
  if (session.ambientTemperature.trim()) {
    const temp = Number(session.ambientTemperature.trim());
    if (Number.isNaN(temp)) return 'Ambient temperature must be a number.';
  }

  if (session.relativeHumidity.trim()) {
    const humidity = Number(session.relativeHumidity.trim());
    if (Number.isNaN(humidity) || humidity < 0 || humidity > 100) {
      return 'Relative humidity must be a number between 0 and 100.';
    }
  }

  return null;
}

/** Minimal checks to save a draft — mandatory fields may be left empty. */
export function validateVerificationDraft(
  session: VerificationSessionValues,
  _deviceImages: Record<string, DeviceVerificationImagesState>,
): string | null {
  if (session.verificationType !== 'OV' && session.verificationType !== 'RV') {
    return 'Select Original Verification or Re-verification.';
  }
  if (!session.customerId.trim()) return 'Select a customer.';

  const included = session.devices.filter(row => row.included);
  if (included.length === 0) return 'Select at least one device.';

  const formatError = validateOptionalSessionFormats(session);
  if (formatError) return formatError;

  for (let i = 0; i < session.devices.length; i++) {
    const row = session.devices[i];
    if (!row.included) continue;
    if (row.maximumPermissibleError.trim()) {
      const mpe = Number(row.maximumPermissibleError.trim());
      if (Number.isNaN(mpe)) return `Device ${i + 1}: MPE must be a number.`;
    }
  }

  return null;
}

export function validateVerificationDeviceRow(
  row: VerificationDeviceRowValues,
  index: number,
  images: DeviceVerificationImagesState,
): string | null {
  const label = `Device ${index + 1}`;
  if (!row.productId.trim()) return `${label}: select a product.`;
  if (!row.serialNumber.trim()) return `${label}: serial number is required.`;

  if (row.maximumPermissibleError.trim()) {
    const mpe = Number(row.maximumPermissibleError.trim());
    if (Number.isNaN(mpe)) return `${label}: MPE must be a number.`;
  }

  if (!row.sealIdentificationNumber.trim()) return `${label}: seal identification number is required.`;

  if (row.verificationLocation !== 'in_situ' && row.verificationLocation !== 'in_premises') {
    return `${label}: select In situ or In the premises.`;
  }

  return validateDeviceVerificationImages(images, label);
}

/** Full validation required before submit for certificate. */
export function validateVerificationForSubmit(
  session: VerificationSessionValues,
  deviceImages: Record<string, DeviceVerificationImagesState>,
): string | null {
  return validateVerificationSession(session, deviceImages);
}

export function validateSiteCalibrationRecord(record: SiteCalibration): string | null {
  const session = verificationSessionFromRecord(record);
  const localId = session.devices[0]?.localId || record.id;
  const images = verificationImagesFromRecord(record);
  return validateVerificationSession(session, { [localId]: images });
}

export function validateVerificationSession(
  session: VerificationSessionValues,
  deviceImages: Record<string, DeviceVerificationImagesState>,
): string | null {
  const headerError = validateSessionHeader(session);
  if (headerError) return headerError;

  const included = session.devices.filter(row => row.included);
  if (included.length === 0) return 'Select at least one device to verify.';

  for (let i = 0; i < session.devices.length; i++) {
    const row = session.devices[i];
    if (!row.included) continue;
    const rowError = validateVerificationDeviceRow(
      row,
      i,
      deviceImages[row.localId] ?? emptyDeviceVerificationImagesState(),
    );
    if (rowError) return rowError;
  }

  return null;
}

export function validateSiteCalibrationForm(values: SiteCalibrationFormValues): string | null {
  if (values.verificationType !== 'OV' && values.verificationType !== 'RV') {
    return 'Select Original Verification or Re-verification.';
  }
  if (!values.customerId.trim()) return 'Select a customer.';
  if (!values.productId.trim()) return 'Select a product.';
  if (!values.serialNumber.trim()) return 'Serial number is required.';

  if (values.maximumPermissibleError.trim()) {
    const mpe = Number(values.maximumPermissibleError.trim());
    if (Number.isNaN(mpe)) return 'MPE must be a number.';
  }

  if (!values.ambientTemperature.trim()) return 'Ambient temperature is required.';
  if (!values.relativeHumidity.trim()) return 'Relative humidity is required.';
  if (!values.sealIdentificationNumber.trim()) return 'Seal identification number is required.';

  const temp = Number(values.ambientTemperature.trim());
  if (Number.isNaN(temp)) return 'Ambient temperature must be a number.';

  const humidity = Number(values.relativeHumidity.trim());
  if (Number.isNaN(humidity) || humidity < 0 || humidity > 100) {
    return 'Relative humidity must be a number between 0 and 100.';
  }

  return null;
}

export function validateScaleImage(
  file: ProductFileMeta | null,
  pendingFile: File | null,
  removed: boolean,
): string | null {
  if (pendingFile) return null;
  if (!removed && file?.url && !file.url.startsWith('blob:')) return null;
  return 'Scale image is required.';
}
