import type { ProductFileMeta } from './productApprovalUpload';
import type { Vehicle } from '../types';

export const VEHICLE_DOC_KEYS = ['rcDoc', 'insuranceDoc', 'pollutionDoc', 'f2WeightDoc'] as const;
export type VehicleDocKey = (typeof VEHICLE_DOC_KEYS)[number];

export const VEHICLE_DOC_LABELS: Record<VehicleDocKey, { label: string; hint: string; requiredMessage: string }> = {
  rcDoc: {
    label: 'RC',
    hint: 'PDF / image',
    requiredMessage: 'RC document is required.',
  },
  insuranceDoc: {
    label: 'Insurance',
    hint: 'PDF / image',
    requiredMessage: 'Insurance document is required.',
  },
  pollutionDoc: {
    label: 'Pollution',
    hint: 'PDF / image',
    requiredMessage: 'Pollution certificate is required.',
  },
  f2WeightDoc: {
    label: 'F2 weight',
    hint: 'PDF / image',
    requiredMessage: 'F2 weight certificate is required.',
  },
};

const DOC_FIELD_PREFIX: Record<VehicleDocKey, string> = {
  rcDoc: 'rcDoc',
  insuranceDoc: 'insuranceDoc',
  pollutionDoc: 'pollutionDoc',
  f2WeightDoc: 'f2WeightDoc',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidVehicleYear(year: string): boolean {
  const y = year.trim();
  if (!/^\d{4}$/.test(y)) return false;
  const n = Number(y);
  return n >= 1980 && n <= new Date().getFullYear() + 1;
}

export function normalizeRegNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function isValidRegNumber(value: string): boolean {
  const v = normalizeRegNumber(value);
  return v.length >= 4 && v.length <= 20;
}

export function isValidDateField(value: string): boolean {
  return DATE_RE.test(value.trim());
}

export type VehicleProfileInput = {
  brand: string;
  model: string;
  year: string;
  regNumber: string;
  rcValidity: string;
  insuranceValidity: string;
  pollutionValidity: string;
  f2WeightValidity: string;
};

export function validateVehicleProfile(input: VehicleProfileInput): string | null {
  if (!input.brand.trim()) return 'Vehicle brand is required.';
  if (!input.model.trim()) return 'Model is required.';
  if (!isValidVehicleYear(input.year)) return 'Enter a valid 4-digit year.';
  if (!isValidRegNumber(input.regNumber)) return 'Registration number is required.';
  if (!isValidDateField(input.rcValidity)) return 'RC validity date is required.';
  if (!isValidDateField(input.insuranceValidity)) return 'Insurance validity date is required.';
  if (!isValidDateField(input.pollutionValidity)) return 'Pollution validity date is required.';
  if (!isValidDateField(input.f2WeightValidity)) return 'F2 weight validity date is required.';
  return null;
}

export function buildVehicleProfileFields(input: VehicleProfileInput): Omit<
  Vehicle,
  'id' | 'rcId' | 'createdAt' | 'createdByUid'
> {
  return {
    brand: input.brand.trim(),
    model: input.model.trim(),
    year: input.year.trim(),
    regNumber: normalizeRegNumber(input.regNumber),
    rcValidity: input.rcValidity.trim(),
    insuranceValidity: input.insuranceValidity.trim(),
    pollutionValidity: input.pollutionValidity.trim(),
    f2WeightValidity: input.f2WeightValidity.trim(),
  };
}

export function vehicleDocMetaFromRecord(record: Vehicle, key: VehicleDocKey): ProductFileMeta | null {
  const prefix = DOC_FIELD_PREFIX[key];
  const url = record[`${prefix}Url` as keyof Vehicle] as string | undefined;
  if (!url) return null;
  return {
    url,
    path: (record[`${prefix}Path` as keyof Vehicle] as string) || '',
    name: (record[`${prefix}Name` as keyof Vehicle] as string) || 'Document',
    contentType: (record[`${prefix}ContentType` as keyof Vehicle] as string) || '',
  };
}

export function vehicleDocFieldsFromMeta(key: VehicleDocKey, meta: ProductFileMeta | null): Partial<Vehicle> {
  const prefix = DOC_FIELD_PREFIX[key];
  if (!meta) {
    return {
      [`${prefix}Url`]: undefined,
      [`${prefix}Path`]: undefined,
      [`${prefix}Name`]: undefined,
      [`${prefix}ContentType`]: undefined,
    } as Partial<Vehicle>;
  }
  return {
    [`${prefix}Url`]: meta.url,
    [`${prefix}Path`]: meta.path,
    [`${prefix}Name`]: meta.name,
    [`${prefix}ContentType`]: meta.contentType,
  } as Partial<Vehicle>;
}

export function requireVehicleDocuments(docs: Record<VehicleDocKey, ProductFileMeta | null>): string | null {
  for (const key of VEHICLE_DOC_KEYS) {
    if (!docs[key]) return VEHICLE_DOC_LABELS[key].requiredMessage;
  }
  return null;
}

export function vehicleDocsFromRecord(record: Vehicle): Record<VehicleDocKey, ProductFileMeta | null> {
  return {
    rcDoc: vehicleDocMetaFromRecord(record, 'rcDoc'),
    insuranceDoc: vehicleDocMetaFromRecord(record, 'insuranceDoc'),
    pollutionDoc: vehicleDocMetaFromRecord(record, 'pollutionDoc'),
    f2WeightDoc: vehicleDocMetaFromRecord(record, 'f2WeightDoc'),
  };
}

export function vehiclePhotoFromRecord(record: Vehicle): ProductFileMeta | null {
  if (!record.vehiclePhotoUrl) return null;
  return {
    url: record.vehiclePhotoUrl,
    path: record.vehiclePhotoPath || '',
    name: record.vehiclePhotoName || 'Vehicle photo',
    contentType: record.vehiclePhotoContentType || 'image/jpeg',
  };
}

export function vehiclePhotoFieldsFromMeta(meta: ProductFileMeta | null): Partial<Vehicle> {
  if (!meta) {
    return {
      vehiclePhotoUrl: '',
      vehiclePhotoPath: '',
      vehiclePhotoName: '',
      vehiclePhotoContentType: '',
    };
  }
  return {
    vehiclePhotoUrl: meta.url,
    vehiclePhotoPath: meta.path,
    vehiclePhotoName: meta.name,
    vehiclePhotoContentType: meta.contentType,
  };
}

export function formatValidityDate(value?: string): string {
  if (!value?.trim()) return '—';
  const d = new Date(`${value.trim()}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN');
}

/** Card display: e.g. 31 Oct 2031 */
export function formatVehicleDisplayDate(value?: string): string {
  if (!value?.trim()) return '—';
  const d = new Date(`${value.trim()}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function validityStatus(value?: string): 'ok' | 'due' | 'expired' | 'missing' {
  if (!value?.trim()) return 'missing';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${value.trim()}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 'missing';
  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'due';
  return 'ok';
}
