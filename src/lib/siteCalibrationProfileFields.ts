import type { JobType, SiteCalibration } from '../types';
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

export function siteCalibrationFormFromRecord(record: SiteCalibration): SiteCalibrationFormValues {
  return {
    verificationType: record.verificationType,
    customerId: record.customerId || '',
    customerName: record.customerName || '',
    productId: record.productId || '',
    productName: record.productName || '',
    serialNumber: record.serialNumber || '',
    maximumPermissibleError:
      record.maximumPermissibleError !== undefined && record.maximumPermissibleError !== null
        ? String(record.maximumPermissibleError)
        : '',
    ambientTemperature: record.ambientTemperature || '',
    relativeHumidity: record.relativeHumidity || '',
    sealIdentificationNumber: record.sealIdentificationNumber || '',
  };
}

export function buildSiteCalibrationFields(
  values: SiteCalibrationFormValues,
): Omit<
  SiteCalibration,
  'id' | 'rcId' | 'createdAt' | 'createdByUid' | 'updatedAt'
> {
  return {
    verificationType: values.verificationType as JobType,
    customerId: values.customerId.trim(),
    customerName: values.customerName.trim(),
    productId: values.productId.trim(),
    productName: values.productName.trim(),
    serialNumber: values.serialNumber.trim(),
    maximumPermissibleError: Number(values.maximumPermissibleError.trim()) || 0,
    ambientTemperature: values.ambientTemperature.trim(),
    relativeHumidity: values.relativeHumidity.trim(),
    sealIdentificationNumber: values.sealIdentificationNumber.trim(),
  };
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
