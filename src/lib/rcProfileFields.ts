import type { CustomerLocation, FirestoreUserDoc } from '../types';
import type { ProductFileMeta } from './productApprovalUpload';
import { resolveLaboratorySealIdentification } from './rcLaboratoryFields';
export {
  vctProfilePhotoFromUser as rcProfilePhotoFromUser,
  vctProfilePhotoFieldsFromMeta as rcProfilePhotoFieldsFromMeta,
} from './vctProfileFields';

export function parseRcLocation(input: {
  latitude?: string;
  longitude?: string;
}): CustomerLocation | undefined {
  const latStr = input.latitude?.trim() ?? '';
  const lngStr = input.longitude?.trim() ?? '';
  if (!latStr || !lngStr) return undefined;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

export function rcProfileCoordsFromUser(doc: FirestoreUserDoc): { latitude: string; longitude: string } {
  return {
    latitude: doc.location?.lat != null ? String(doc.location.lat) : '',
    longitude: doc.location?.lng != null ? String(doc.location.lng) : '',
  };
}

export function formatRcLocation(doc: FirestoreUserDoc): string {
  if (!doc.location) return '—';
  return `${doc.location.lat.toFixed(5)}, ${doc.location.lng.toFixed(5)}`;
}

export function rcMapsUrl(doc: FirestoreUserDoc): string | null {
  if (!doc.location) return null;
  return `https://www.google.com/maps?q=${doc.location.lat},${doc.location.lng}`;
}

/** Certificate date + 1 year (YYYY-MM-DD). */
export function standardWeightsCertExpiryFromDate(certDate: string): string {
  if (!certDate.trim()) return '';
  const d = new Date(`${certDate.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export type RcFormValues = {
  companyName: string;
  contactPerson: string;
  place: string;
  address: string;
  aadhar: string;
  email: string;
  phone: string;
  gstNumber: string;
  password: string;
  standardWeightsCertNumber: string;
  standardWeightsCertDate: string;
};

export const EMPTY_RC_FORM: RcFormValues = {
  companyName: '',
  contactPerson: '',
  place: '',
  address: '',
  aadhar: '',
  email: '',
  phone: '',
  gstNumber: '',
  password: '',
  standardWeightsCertNumber: '',
  standardWeightsCertDate: '',
};

export function rcFormFromUser(doc: FirestoreUserDoc): RcFormValues {
  return {
    companyName: doc.companyName || doc.username || '',
    contactPerson: doc.contactPerson || '',
    place: doc.place || '',
    address: doc.address || '',
    aadhar: doc.aadhar || '',
    email: doc.email || '',
    phone: doc.phone || '',
    gstNumber: doc.gstNumber || '',
    password: '',
    standardWeightsCertNumber: doc.standardWeightsCertNumber || '',
    standardWeightsCertDate: doc.standardWeightsCertDate || '',
  };
}

export type RcFormUploads = {
  cert: ProductFileMeta | null;
  seal: ProductFileMeta | null;
};

function applyFileMeta(
  base: Partial<FirestoreUserDoc>,
  prefix: 'standardWeightsCert' | 'seal',
  file: ProductFileMeta | null,
  isCreate: boolean,
): void {
  const urlKey = `${prefix}Url` as keyof FirestoreUserDoc;
  const pathKey = `${prefix}Path` as keyof FirestoreUserDoc;
  const nameKey = `${prefix}Name` as keyof FirestoreUserDoc;
  const typeKey = `${prefix}ContentType` as keyof FirestoreUserDoc;

  if (file) {
    (base as Record<string, string>)[urlKey] = file.url;
    (base as Record<string, string>)[pathKey] = file.path;
    (base as Record<string, string>)[nameKey] = file.name;
    (base as Record<string, string>)[typeKey] = file.contentType;
  } else if (isCreate) {
    (base as Record<string, string>)[urlKey] = '';
    (base as Record<string, string>)[pathKey] = '';
    (base as Record<string, string>)[nameKey] = '';
    (base as Record<string, string>)[typeKey] = '';
  }
}

export function buildRcFirestoreFields(
  values: RcFormValues,
  uploads: RcFormUploads,
  options: { includePassword?: string; isCreate?: boolean },
): Partial<FirestoreUserDoc> {
  const expiry = standardWeightsCertExpiryFromDate(values.standardWeightsCertDate);
  const base: Partial<FirestoreUserDoc> = {
    companyName: values.companyName.trim(),
    username: values.companyName.trim(),
    contactPerson: values.contactPerson.trim(),
    place: values.place.trim(),
    address: values.address.trim(),
    gstNumber: values.gstNumber.trim(),
    email: values.email.trim(),
    phone: values.phone.replace(/\D/g, '').slice(0, 10),
    standardWeightsCertNumber: values.standardWeightsCertNumber.trim(),
    standardWeightsCertDate: values.standardWeightsCertDate,
    standardWeightsCertExpiry: expiry,
  };

  if (options.isCreate) {
    base.laboratorySealIdentification = resolveLaboratorySealIdentification(null);
  }

  applyFileMeta(base, 'standardWeightsCert', uploads.cert, Boolean(options.isCreate));
  applyFileMeta(base, 'seal', uploads.seal, Boolean(options.isCreate));

  if (options.includePassword) {
    base.clearTextPassword = options.includePassword;
  }

  return base;
}
