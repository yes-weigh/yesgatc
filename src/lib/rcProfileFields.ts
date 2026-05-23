import type { FirestoreUserDoc } from '../types';
import type { ProductFileMeta } from './productApprovalUpload';

/** Certificate date + 1 year + 1 day (YYYY-MM-DD). */
export function standardWeightsCertExpiryFromDate(certDate: string): string {
  if (!certDate.trim()) return '';
  const d = new Date(`${certDate.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() + 1);
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

export function buildRcFirestoreFields(
  values: RcFormValues,
  cert: ProductFileMeta | null,
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

  if (cert) {
    base.standardWeightsCertUrl = cert.url;
    base.standardWeightsCertPath = cert.path;
    base.standardWeightsCertName = cert.name;
    base.standardWeightsCertContentType = cert.contentType;
  } else if (options.isCreate) {
    base.standardWeightsCertUrl = '';
    base.standardWeightsCertPath = '';
    base.standardWeightsCertName = '';
    base.standardWeightsCertContentType = '';
  }

  if (options.includePassword) {
    base.clearTextPassword = options.includePassword;
  }

  return base;
}
