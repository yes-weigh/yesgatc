import type { Customer, CustomerDevice, JobType, Product, SiteCalibration } from '../types';
import type { ProductFileMeta } from './productApprovalUpload';

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
};

export type VerificationSessionValues = {
  verificationType: JobType | '';
  customerId: string;
  customerName: string;
  ambientTemperature: string;
  relativeHumidity: string;
  devices: VerificationDeviceRowValues[];
};

export type DeviceScaleImageState = {
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
  pendingFile: File | null;
  removed: boolean;
};

export const EMPTY_SITE_CALIBRATION_FORM: SiteCalibrationFormValues = {
  verificationType: '',
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
  verificationType: '',
  customerId: '',
  customerName: '',
  ambientTemperature: '',
  relativeHumidity: '',
  devices: [],
};

export function emptyDeviceScaleImageState(): DeviceScaleImageState {
  return {
    file: null,
    uploading: false,
    progress: 0,
    pendingFile: null,
    removed: false,
  };
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
  };
}

export function deviceRowsFromCustomer(
  customer: Customer | null | undefined,
  products: Product[],
): VerificationDeviceRowValues[] {
  if (!customer?.devices?.length) return [];
  return customer.devices.map(device => deviceRowFromCustomerDevice(device, products));
}

export function deviceImageStatesFromRows(
  rows: VerificationDeviceRowValues[],
): Record<string, DeviceScaleImageState> {
  return Object.fromEntries(rows.map(row => [row.localId, emptyDeviceScaleImageState()]));
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
): Omit<SiteCalibration, 'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt'> {
  const fields: Omit<SiteCalibration, 'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt'> = {
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
  };
  if (row.deviceId.trim()) fields.deviceId = row.deviceId.trim();
  return fields;
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

export function validateVerificationDeviceRow(
  row: VerificationDeviceRowValues,
  index: number,
  image: DeviceScaleImageState,
): string | null {
  const label = `Device ${index + 1}`;
  if (!row.productId.trim()) return `${label}: select a product.`;
  if (!row.serialNumber.trim()) return `${label}: serial number is required.`;

  if (row.maximumPermissibleError.trim()) {
    const mpe = Number(row.maximumPermissibleError.trim());
    if (Number.isNaN(mpe)) return `${label}: MPE must be a number.`;
  }

  if (!row.sealIdentificationNumber.trim()) return `${label}: seal identification number is required.`;

  const imageError = validateScaleImage(image.file, image.pendingFile, image.removed);
  if (imageError) return `${label}: ${imageError}`;

  return null;
}

export function validateVerificationSession(
  session: VerificationSessionValues,
  deviceImages: Record<string, DeviceScaleImageState>,
): string | null {
  const headerError = validateSessionHeader(session);
  if (headerError) return headerError;

  const included = session.devices.filter(row => row.included);
  if (included.length === 0) return 'Select at least one device to verify.';

  for (let i = 0; i < session.devices.length; i++) {
    const row = session.devices[i];
    if (!row.included) continue;
    const rowError = validateVerificationDeviceRow(row, i, deviceImages[row.localId] ?? emptyDeviceScaleImageState());
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

export function scaleImageFromRecord(record: SiteCalibration): ProductFileMeta | null {
  if (!record.scaleImageUrl) return null;
  return {
    url: record.scaleImageUrl,
    path: record.scaleImagePath || '',
    name: record.scaleImageName || 'Scale image',
    contentType: record.scaleImageContentType || 'image/jpeg',
  };
}

export function scaleImageFieldsFromMeta(meta: ProductFileMeta | null): Partial<SiteCalibration> {
  if (!meta) {
    return {
      scaleImageUrl: '',
      scaleImagePath: '',
      scaleImageName: '',
      scaleImageContentType: '',
    };
  }
  return {
    scaleImageUrl: meta.url,
    scaleImagePath: meta.path,
    scaleImageName: meta.name,
    scaleImageContentType: meta.contentType,
  };
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
