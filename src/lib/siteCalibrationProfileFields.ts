import type { Customer, CustomerDevice, JobType, Product, SiteCalibration, VerificationLocation } from '../types';
import {
  isCustomerPartyReadyToPersist,
  isPendingNewCustomerParty,
  validateCustomerProfile,
  type CustomerFormValues,
} from './customerProfileFields';
import {
  buildRcDirectVerificationMeta,
  normalizeVerificationStatus,
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
import {
  deviceRvDocumentsFromRows,
  emptyDeviceRvDocumentsState,
  isValidManufacturingYear,
  rvDocumentsFromRecord,
  validateDeviceRvDocuments,
  type DeviceRvDocumentsState,
} from './verificationRvDeviceImages';

export type { DeviceVerificationImagesState, DeviceImageSlotState, VerificationImageKind } from './verificationDeviceImages';
export type { DeviceRvDocumentsState, RvDocumentKind } from './verificationRvDeviceImages';

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

export type VerificationSubject = 'self' | 'customer';

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
  /** Re-verification only — year of manufacturing (YYYY). */
  manufacturingYear: string;
  /** @deprecated session-level verificationLocation is used instead */
  verificationLocation: VerificationLocation | '';
};

export type VerificationSessionValues = {
  verificationType: JobType | '';
  verificationSubject: VerificationSubject;
  customerId: string;
  customerName: string;
  ambientTemperature: string;
  relativeHumidity: string;
  verificationLocation: VerificationLocation | '';
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
  verificationSubject: 'self',
  customerId: '',
  customerName: '',
  ambientTemperature: '',
  relativeHumidity: '',
  verificationLocation: 'in_situ',
  devices: [],
};

export function inferVerificationSubject(
  record: Pick<SiteCalibration, 'verificationSubject' | 'customerId' | 'rcId'>,
): VerificationSubject {
  if (record.verificationSubject === 'self' || record.verificationSubject === 'customer') {
    return record.verificationSubject;
  }
  if (record.customerId && record.rcId && record.customerId === record.rcId) return 'self';
  return 'customer';
}

export function buildInitialSelfDeviceRows(sealIdentification = ''): VerificationDeviceRowValues[] {
  return [{
    ...createEmptyVerificationDeviceRow(),
    sealIdentificationNumber: sealIdentification,
  }];
}

export function buildSelfVerificationSession(
  rc: Pick<import('../types').FirestoreUserDoc, 'companyName' | 'username'>,
  rcUid: string,
  sealIdentification = '',
): VerificationSessionValues {
  return {
    verificationType: 'OV',
    verificationSubject: 'self',
    customerId: rcUid,
    customerName: rc.companyName?.trim() || rc.username?.trim() || '',
    ambientTemperature: '',
    relativeHumidity: '',
    verificationLocation: 'in_situ',
    devices: buildInitialSelfDeviceRows(sealIdentification),
  };
}

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

export function deviceRvImageStatesFromRows(
  rows: VerificationDeviceRowValues[],
): Record<string, DeviceRvDocumentsState> {
  return deviceRvDocumentsFromRows(rows);
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
    manufacturingYear: '',
    verificationLocation: '',
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
    manufacturingYear: '',
    verificationLocation: '',
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
      manufacturingYear: existing.manufacturingYear,
    };
  });

  return [...merged, ...newDeviceRows];
}

export function verificationSessionFromRecord(
  record: SiteCalibration,
): VerificationSessionValues {
  const subject = inferVerificationSubject(record);
  return {
    verificationType: record.verificationType,
    verificationSubject: subject,
    customerId: record.customerId || '',
    customerName: record.customerName || '',
    ambientTemperature: record.ambientTemperature || '',
    relativeHumidity: record.relativeHumidity || '',
    verificationLocation: record.verificationLocation || 'in_situ',
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
        manufacturingYear:
          record.manufacturingYear !== undefined && record.manufacturingYear !== null
            ? String(record.manufacturingYear)
            : '',
        verificationLocation: '',
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
    verificationLocation: session.verificationLocation as VerificationLocation,
    verificationSubject: session.verificationSubject,
    ...productSnapshotFromProduct(options?.product),
  };
  if (row.deviceId.trim()) fields.deviceId = row.deviceId.trim();
  if (session.verificationType === 'RV') {
    const year = row.manufacturingYear.trim();
    if (year) fields.manufacturingYear = Number(year);
  }
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
      verificationSubject: 'customer',
      ambientTemperature: values.ambientTemperature,
      relativeHumidity: values.relativeHumidity,
      verificationLocation: 'in_situ',
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
      manufacturingYear: '',
      verificationLocation: '',
    },
  );
}

export type VerificationValidationOptions = {
  customerForm?: CustomerFormValues;
};

function validatePendingCustomerParty(
  customerForm: CustomerFormValues | undefined,
  forSave: boolean,
): string | null {
  if (!customerForm || !isPendingNewCustomerParty(customerForm)) {
    return forSave
      ? 'Select a customer from lookup or complete customer details.'
      : 'Select a customer from lookup or enter name and mobile number.';
  }
  if (!forSave) return null;
  if (!isCustomerPartyReadyToPersist(customerForm)) {
    return 'Complete postal code and wait for district and state before saving.';
  }
  return validateCustomerProfile(customerForm);
}

function validateSessionHeader(
  session: VerificationSessionValues,
  options?: VerificationValidationOptions,
): string | null {
  if (session.verificationType !== 'OV' && session.verificationType !== 'RV') {
    return 'Select Original Verification or Re-verification.';
  }
  if (session.verificationSubject === 'customer' && !session.customerId.trim()) {
    const pendingError = validatePendingCustomerParty(options?.customerForm, true);
    if (pendingError) return pendingError;
  }
  if (session.verificationSubject === 'self' && !session.customerName.trim()) {
    return 'RC centre details are required for self verification.';
  }

  if (session.verificationLocation !== 'in_situ' && session.verificationLocation !== 'in_premises') {
    return 'Select In situ or In the premises.';
  }

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
  _deviceRvImages: Record<string, DeviceRvDocumentsState> = {},
  options?: VerificationValidationOptions,
): string | null {
  if (session.verificationType !== 'OV' && session.verificationType !== 'RV') {
    return 'Select Original Verification or Re-verification.';
  }
  if (session.verificationSubject === 'customer' && !session.customerId.trim()) {
    const pendingError = validatePendingCustomerParty(options?.customerForm, true);
    if (pendingError) return pendingError;
  }
  if (session.verificationSubject === 'self' && !session.customerName.trim()) {
    return 'RC centre details are required for self verification.';
  }

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
    if (session.verificationType === 'RV' && row.manufacturingYear.trim()) {
      if (!isValidManufacturingYear(row.manufacturingYear)) {
        return `Device ${i + 1}: select a valid year of manufacturing.`;
      }
    }
  }

  return null;
}

export function validateVerificationDeviceDetails(
  row: VerificationDeviceRowValues,
  index: number,
  options?: { verificationType?: JobType | '' },
): string | null {
  const label = `Device ${index + 1}`;
  if (!row.productId.trim()) return `${label}: select a product.`;
  if (!row.serialNumber.trim()) return `${label}: serial number is required.`;

  if (row.maximumPermissibleError.trim()) {
    const mpe = Number(row.maximumPermissibleError.trim());
    if (Number.isNaN(mpe)) return `${label}: MPE must be a number.`;
  }

  if (!row.sealIdentificationNumber.trim()) return `${label}: seal identification number is required.`;

  if (options?.verificationType === 'RV') {
    if (!isValidManufacturingYear(row.manufacturingYear)) {
      return `${label}: select year of manufacturing.`;
    }
  }

  return null;
}

export function validateVerificationDeviceRow(
  row: VerificationDeviceRowValues,
  index: number,
  images: DeviceVerificationImagesState,
  options?: {
    verificationType?: JobType | '';
    rvDocuments?: DeviceRvDocumentsState;
  },
): string | null {
  const detailsError = validateVerificationDeviceDetails(row, index, {
    verificationType: options?.verificationType,
  });
  if (detailsError) return detailsError;

  const label = `Device ${index + 1}`;

  if (options?.verificationType === 'RV') {
    const rvError = validateDeviceRvDocuments(
      options.rvDocuments ?? emptyDeviceRvDocumentsState(),
      label,
    );
    if (rvError) return rvError;
  }

  return validateDeviceVerificationImages(images, label, options?.verificationType);
}

/** Full validation required before submit for certificate. */
export function validateVerificationForSubmit(
  session: VerificationSessionValues,
  deviceImages: Record<string, DeviceVerificationImagesState>,
  deviceRvImages: Record<string, DeviceRvDocumentsState> = {},
  options?: VerificationValidationOptions,
): string | null {
  return validateVerificationSession(session, deviceImages, deviceRvImages, options);
}

export function validateSiteCalibrationRecord(record: SiteCalibration): string | null {
  const session = verificationSessionFromRecord(record);
  const localId = session.devices[0]?.localId || record.id;
  const images = verificationImagesFromRecord(record);
  const rvDocuments = session.verificationType === 'RV' ? rvDocumentsFromRecord(record) : undefined;
  return validateVerificationSession(session, { [localId]: images }, rvDocuments ? { [localId]: rvDocuments } : {});
}

export function siteCalibrationSubmitBlockReason(record: SiteCalibration): string | null {
  return validateSiteCalibrationRecord(record);
}

export function isSiteCalibrationSubmittable(record: SiteCalibration): boolean {
  if (normalizeVerificationStatus(record) !== 'draft') return false;
  return validateSiteCalibrationRecord(record) === null;
}

export function validateVerificationSession(
  session: VerificationSessionValues,
  deviceImages: Record<string, DeviceVerificationImagesState>,
  deviceRvImages: Record<string, DeviceRvDocumentsState> = {},
  options?: VerificationValidationOptions,
): string | null {
  const headerError = validateSessionHeader(session, options);
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
      {
        verificationType: session.verificationType,
        rvDocuments: deviceRvImages[row.localId],
      },
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
