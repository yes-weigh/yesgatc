import type { Customer, CustomerDevice, JobType, Product, RcFeesStructure, SiteCalibration, VerificationLocation } from '../types';
import { rcFilingPartyPatch } from './keralaRegion';
import { DEFAULT_RC_FEES_STRUCTURE } from './rcProfileFields';
import { computeRvCustomerFeeLine } from './rvFeeBreakdown';
import { parseAdditionalFeeInput } from './verificationDocaCharges';
import {
  isCustomerPartyReadyToPersist,
  isPendingNewCustomerParty,
  validateCustomerProfile,
  type CustomerFormValues,
} from './customerProfileFields';
import {
  buildVerificationDraftMeta,
  normalizeVerificationStatus,
  productSnapshotFromProduct,
  type VerificationDraftActorMeta,
} from './verificationRequest';
import { productHasMultipleSpecifications, resolveProductSpecification } from './productSpecifications';
import type { ProductFileMeta } from './productApprovalUpload';
import {
  deviceVerificationImagesFromRows,
  emptyDeviceVerificationImagesState,
  validateDeviceVerificationImages,
  verificationImagesFromRecord,
  type DeviceVerificationImagesState,
} from './verificationDeviceImages';
import { validateRvZohoSubmitReady } from './zohoRvSubmit';
import {
  deviceRvDocumentsFromRows,
  emptyDeviceRvDocumentsState,
  isValidManufacturingYear,
  rvDocumentsFromRecord,
  validateDeviceRvDocuments,
  type DeviceRvDocumentsState,
} from './verificationRvDeviceImages';
import {
  emptyPerformerPhotosState,
  performerPhotosFromRecord,
  recordHasPerformerPhotos,
  requiresPerformerIdentityPhotos,
  validatePerformerPhotos,
  type PerformerPhotosState,
} from './verificationPerformerPhotos';
import {
  validatePartyPincodeForSubmit,
  validateVerificationImagesUploaded,
  verificationHasPendingUploads,
  verificationOnlineBlockReason,
  verificationUploadsInProgressBlockReason,
} from './verificationSubmitGates';
import { validateOvQuotaDevices, type OvQuotaGate } from './ovQuotaGate';
import { verificationClientVersionFields } from './verificationAppVersion';

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
  /** Selected capacity row when the product has multiple specifications. */
  productSpecificationId?: string;
  serialNumber: string;
  maximumPermissibleError: string;
  sealIdentificationNumber: string;
  /** Re-verification only — year of manufacturing (YYYY). */
  manufacturingYear: string;
  /** Carriage / conveyance (INR) — stored for DOCA; automation uses 0 until wired. */
  carriageConveyanceFee: string;
  /** RV RC fees (INR) — computed Total − (GATC + GST); stored on save. */
  serviceFee: string;
  /** RV additional fee (INR) — editable per device. */
  additionalFee: string;
  /** RV discount (INR) — editable per device. */
  discountFee: string;
  /** @deprecated session-level verificationLocation is used instead */
  verificationLocation: VerificationLocation | '';
};

export type VerificationSessionValues = {
  verificationType: JobType | '';
  verificationSubject: VerificationSubject;
  /** RC admin: empty = RC centre (Self); otherwise assigned VCT uid. */
  assignedVctId?: string;
  customerId: string;
  customerName: string;
  ambientTemperature: string;
  relativeHumidity: string;
  verificationLocation: VerificationLocation | '';
  devices: VerificationDeviceRowValues[];
  /** OV serial chosen on the allotted seat map. Survives device-row rebuilds. */
  lockedSerial?: string;
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
  assignedVctId: '',
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
    assignedVctId: '',
    customerId: rcUid,
    customerName: rc.companyName?.trim() || rc.username?.trim() || '',
    ambientTemperature: '',
    relativeHumidity: '',
    verificationLocation: 'in_situ',
    devices: buildInitialSelfDeviceRows(sealIdentification),
  };
}

export type VerificationJobKind = 'ov_self' | 'ov_customer' | 'rv_customer';

export function verificationJobKindLabel(kind: VerificationJobKind): string {
  if (kind === 'ov_self') return 'OV Self';
  if (kind === 'ov_customer') return 'OV Customer';
  return 'RV Customer';
}

export function verificationSessionKindLabel(
  verificationType: string,
  verificationSubject: string,
): string {
  if (verificationType === 'RV') return 'RV Customer';
  return verificationSubject === 'self' ? 'OV Self' : 'OV Customer';
}

export function applyLockedSerialToDevices(
  devices: VerificationDeviceRowValues[],
  lockedSerial: string | undefined,
): VerificationDeviceRowValues[] {
  const serial = lockedSerial?.trim() ?? '';
  if (!serial || devices.length === 0) return devices;
  if (devices.some(row => row.serialNumber.trim() === serial)) return devices;
  return devices.map((row, index) =>
    index === 0 ? { ...row, serialNumber: serial } : row,
  );
}

export function buildVerificationSessionForKind(
  kind: VerificationJobKind,
  rc: Pick<import('../types').FirestoreUserDoc, 'companyName' | 'username'>,
  rcUid: string,
  sealIdentification = '',
  serialNumber = '',
  manufacturingYear = '',
): VerificationSessionValues {
  const session =
    kind === 'ov_self'
      ? buildSelfVerificationSession(rc, rcUid, sealIdentification)
      : {
          ...EMPTY_VERIFICATION_SESSION,
          verificationType: kind === 'rv_customer' ? ('RV' as const) : ('OV' as const),
          verificationSubject: 'customer' as const,
          assignedVctId: '',
          devices: buildInitialSelfDeviceRows(sealIdentification),
        };
  const serial = serialNumber.trim();
  const year = manufacturingYear.trim();
  let devices = session.devices;
  if (serial) devices = applyLockedSerialToDevices(devices, serial);
  if (year && devices.length > 0) {
    devices = devices.map((row, index) =>
      index === 0 ? { ...row, manufacturingYear: year } : row,
    );
  }
  if (!serial && !year) return session;
  return {
    ...session,
    ...(serial ? { lockedSerial: serial } : {}),
    devices,
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
    productSpecificationId: '',
    serialNumber: '',
    maximumPermissibleError: '',
    sealIdentificationNumber: '',
    manufacturingYear: '',
    carriageConveyanceFee: '0',
    serviceFee: '',
    additionalFee: '0',
    discountFee: '0',
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

export function mpeStringFromProductSpec(
  product: Product | null | undefined,
  specificationId?: string | null,
): string {
  if (!product) return '';
  return mpeStringFromProduct(resolveProductSpecification(product, specificationId));
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
    productSpecificationId: '',
    serialNumber: device.serialNumber,
    maximumPermissibleError: mpeStringFromProduct(product),
    sealIdentificationNumber: '',
    manufacturingYear: '',
    carriageConveyanceFee: '0',
    serviceFee: '',
    additionalFee: '0',
    discountFee: '0',
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
      carriageConveyanceFee: existing.carriageConveyanceFee,
      serviceFee: existing.serviceFee,
      additionalFee: existing.additionalFee ?? '0',
      discountFee: existing.discountFee ?? '0',
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
    assignedVctId: record.performedBy === 'vct' && record.vctId ? record.vctId : '',
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
        productSpecificationId: record.productSpecificationId || '',
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
        carriageConveyanceFee:
          record.carriageConveyanceFee !== undefined && record.carriageConveyanceFee !== null
            ? String(record.carriageConveyanceFee)
            : '0',
        serviceFee:
          record.serviceFee !== undefined && record.serviceFee !== null
            ? String(record.serviceFee)
            : '',
        additionalFee:
          record.additionalFee !== undefined && record.additionalFee !== null
            ? String(record.additionalFee)
            : '0',
        discountFee:
          record.discountFee !== undefined && record.discountFee !== null
            ? String(record.discountFee)
            : '0',
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
  options?: {
    product?: Product | null;
    feesStructure?: RcFeesStructure | null;
    docaCharges?: import('./verificationDocaCharges').VerificationDocaChargeFields | null;
    partyPincode?: string | null;
    rcUid?: string | null;
    rcCompanyName?: string | null;
  },
): Omit<
  SiteCalibration,
  'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt' | 'status' | 'submittedAt' | 'approvedAt'
> {
  const filing = rcFilingPartyPatch({
    verificationSubject: session.verificationSubject,
    customerId: session.customerId,
    customerName: session.customerName,
    pincode: options?.partyPincode,
    rcUid: options?.rcUid,
    rcCompanyName: options?.rcCompanyName,
  });
  const fields: Omit<
    SiteCalibration,
    'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt' | 'status' | 'submittedAt' | 'approvedAt'
  > = {
    verificationType: session.verificationType as JobType,
    customerId: filing.customerId ?? session.customerId.trim(),
    customerName: filing.customerName ?? session.customerName.trim(),
    productId: row.productId.trim(),
    productName: row.productName.trim(),
    serialNumber: row.serialNumber.trim(),
    maximumPermissibleError: Number(row.maximumPermissibleError.trim()) || 0,
    ambientTemperature: session.ambientTemperature.trim(),
    relativeHumidity: session.relativeHumidity.trim(),
    sealIdentificationNumber: row.sealIdentificationNumber.trim(),
    verificationLocation: session.verificationLocation as VerificationLocation,
    verificationSubject: filing.verificationSubject ?? session.verificationSubject,
    fileCertificateAsRc: filing.fileCertificateAsRc,
    ...(filing.sourceCustomerId ? { sourceCustomerId: filing.sourceCustomerId } : {}),
    ...(filing.sourceCustomerName ? { sourceCustomerName: filing.sourceCustomerName } : {}),
    ...productSnapshotFromProduct(options?.product, row.productSpecificationId),
  };
  if (row.productSpecificationId?.trim()) {
    fields.productSpecificationId = row.productSpecificationId.trim();
  }
  if (row.deviceId.trim()) fields.deviceId = row.deviceId.trim();
  if (session.verificationType === 'RV') {
    const year = row.manufacturingYear.trim();
    if (year) fields.manufacturingYear = Number(year);
    const feeProduct = options?.product
      ? {
          maximumCapacity: resolveProductSpecification(
            options.product,
            row.productSpecificationId,
          ).maximumCapacity,
          unitOfMeasurement: options.product.unitOfMeasurement || 'kg',
        }
      : null;
    const feeLine = computeRvCustomerFeeLine({
      product: feeProduct,
      fees: options?.feesStructure ?? DEFAULT_RC_FEES_STRUCTURE,
      additionalFee: row.additionalFee,
      discountFee: row.discountFee,
    });
    fields.serviceFee = feeLine?.rcFees ?? 0;
    fields.additionalFee = feeLine?.additionalFee ?? parseAdditionalFeeInput(row.additionalFee);
    fields.discountFee = feeLine?.discount ?? 0;
  }
  if (options?.docaCharges) {
    Object.assign(fields, options.docaCharges);
  }
  Object.assign(fields, verificationClientVersionFields());
  return fields;
}

export function buildNewSiteCalibrationRecord(
  session: VerificationSessionValues,
  row: VerificationDeviceRowValues,
  product?: Product | null,
  draftActor: VerificationDraftActorMeta = { actor: 'rc' },
  docaCharges?: import('./verificationDocaCharges').VerificationDocaChargeFields | null,
  partyPincode?: string | null,
  rcParty?: { uid: string; name: string } | null,
  feesStructure?: RcFeesStructure | null,
): Omit<SiteCalibration, 'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt'> {
  return {
    ...buildSiteCalibrationFromRow(session, row, {
      product,
      feesStructure,
      docaCharges,
      partyPincode,
      rcUid: rcParty?.uid,
      rcCompanyName: rcParty?.name,
    }),
    ...buildVerificationDraftMeta(draftActor),
    ...verificationClientVersionFields(),
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
      productSpecificationId: '',
      serialNumber: values.serialNumber,
      maximumPermissibleError: values.maximumPermissibleError,
      sealIdentificationNumber: values.sealIdentificationNumber,
      manufacturingYear: '',
      carriageConveyanceFee: '0',
      serviceFee: '',
      additionalFee: '0',
      discountFee: '0',
      verificationLocation: '',
    },
  );
}

export type VerificationValidationOptions = {
  customerForm?: CustomerFormValues;
  rcForm?: CustomerFormValues;
  /** List submit — customer record pincode when form is closed. */
  customerPincode?: string | null;
  /** List submit — RC profile pincode when form is closed. */
  rcPincode?: string | null;
  rcZohoId?: string | null;
  zohoRvInvoicingEnabled?: boolean;
  performerPhotos?: PerformerPhotosState;
  /** Skip performer photo requirement when editing legacy draft on record that already has them. */
  skipPerformerPhotos?: boolean;
  /**
   * When true, required photos must already be on Firebase (no pending local files).
   * Used for list submit and after inline upload completes.
   */
  requireUploadedImages?: boolean;
  ovQuota?: OvQuotaGate | null;
  isNewJob?: boolean;
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

  const pincodeError = validatePartyPincodeForSubmit({
    verificationSubject: session.verificationSubject,
    customerForm: options?.customerForm,
    rcForm: options?.rcForm,
    customerPincode: options?.customerPincode,
    rcPincode: options?.rcPincode,
  });
  if (pincodeError) return pincodeError;

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
    // Draft: name + mobile enough; full address required only on submit / new-customer persist.
    const pendingError = validatePendingCustomerParty(options?.customerForm, false);
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

  return validateOvQuotaDevices(
    session.verificationType,
    included.map(row => row.serialNumber),
    options?.ovQuota,
  );
}

export function validateVerificationDeviceDetails(
  row: VerificationDeviceRowValues,
  index: number,
  options?: {
    verificationType?: JobType | '';
    product?: Product | null;
  },
): string | null {
  const label = `Device ${index + 1}`;
  if (!row.productId.trim()) return `${label}: select a product.`;
  if (
    options?.product &&
    productHasMultipleSpecifications(options.product) &&
    !row.productSpecificationId?.trim()
  ) {
    return `${label}: select a capacity specification.`;
  }
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
  const onlineError = verificationOnlineBlockReason();
  if (onlineError) return onlineError;

  const uploadingError = verificationUploadsInProgressBlockReason(
    deviceImages,
    deviceRvImages,
    options?.performerPhotos,
  );
  if (uploadingError) return uploadingError;

  const sessionError = validateVerificationSession(session, deviceImages, deviceRvImages, options);
  if (sessionError) return sessionError;

  const hasPending = verificationHasPendingUploads(
    deviceImages,
    deviceRvImages,
    options?.performerPhotos,
  );
  if (options?.requireUploadedImages || !hasPending) {
    const includedIds = session.devices.filter(row => row.included).map(row => row.localId);
    const uploadedError = validateVerificationImagesUploaded(
      session.verificationType,
      deviceImages,
      includedIds,
      deviceRvImages,
      options?.performerPhotos,
      { skipPerformerPhotos: options?.skipPerformerPhotos },
    );
    if (uploadedError) return uploadedError;
  } else if (hasPending) {
    // Pending local files are allowed only while online — upload runs before status change.
    const stillOffline = verificationOnlineBlockReason();
    if (stillOffline) return stillOffline;
  }

  return validateRvZohoSubmitReady(
    session.verificationType,
    options?.rcZohoId,
    { zohoRvInvoicingEnabled: options?.zohoRvInvoicingEnabled !== false },
  );
}

export function validateSiteCalibrationRecord(
  record: SiteCalibration,
  options?: VerificationValidationOptions,
): string | null {
  const onlineError = verificationOnlineBlockReason();
  if (onlineError) return onlineError;

  const session = verificationSessionFromRecord(record);
  const localId = session.devices[0]?.localId || record.id;
  const images = verificationImagesFromRecord(record);
  const rvDocuments = session.verificationType === 'RV' ? rvDocumentsFromRecord(record) : undefined;
  const performerFromRecord = performerPhotosFromRecord(record);
  const skipPerformerPhotos =
    !requiresPerformerIdentityPhotos(session.verificationType)
    || recordHasPerformerPhotos(record);

  const sessionError = validateVerificationSession(
    session,
    { [localId]: images },
    rvDocuments ? { [localId]: rvDocuments } : {},
    {
      ...options,
      performerPhotos: performerFromRecord,
      requireUploadedImages: true,
      skipPerformerPhotos,
    },
  );
  if (sessionError) return sessionError;

  const uploadedError = validateVerificationImagesUploaded(
    session.verificationType,
    { [localId]: images },
    [localId],
    rvDocuments ? { [localId]: rvDocuments } : {},
    performerFromRecord,
    { skipPerformerPhotos: !requiresPerformerIdentityPhotos(session.verificationType) },
  );
  if (uploadedError) return uploadedError;

  return validateRvZohoSubmitReady(
    record.verificationType,
    options?.rcZohoId,
    { zohoRvInvoicingEnabled: options?.zohoRvInvoicingEnabled !== false },
  );
}

export function siteCalibrationSubmitBlockReason(
  record: SiteCalibration,
  options?: VerificationValidationOptions,
): string | null {
  return validateSiteCalibrationRecord(record, options);
}

export function isSiteCalibrationSubmittable(
  record: SiteCalibration,
  options?: VerificationValidationOptions,
): boolean {
  if (normalizeVerificationStatus(record) !== 'draft') return false;
  return validateSiteCalibrationRecord(record, options) === null;
}

export function validateVerificationSession(
  session: VerificationSessionValues,
  deviceImages: Record<string, DeviceVerificationImagesState>,
  deviceRvImages: Record<string, DeviceRvDocumentsState> = {},
  options?: VerificationValidationOptions,
): string | null {
  const headerError = validateSessionHeader(session, options);
  if (headerError) return headerError;

  if (
    requiresPerformerIdentityPhotos(session.verificationType)
    && !options?.skipPerformerPhotos
  ) {
    const performerError = validatePerformerPhotos(
      options?.performerPhotos ?? emptyPerformerPhotosState(),
    );
    if (performerError) return performerError;
  }

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

  return validateOvQuotaDevices(
    session.verificationType,
    included.map(row => row.serialNumber),
    options?.ovQuota,
  );
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
