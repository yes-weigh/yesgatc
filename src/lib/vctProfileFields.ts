import type { ProductFileMeta } from './productApprovalUpload';
import { isValidPhone, isValidPincode, normalizePhone, normalizePincode } from './contactFields';
import type { FirestoreUserDoc } from '../types';

export type VctDocKey = 'biodata' | 'educationCert' | 'pcc';

const DOC_FIELD_PREFIX: Record<VctDocKey, string> = {
  biodata: 'biodataDoc',
  educationCert: 'educationCertDoc',
  pcc: 'pccDoc',
};

export function vctDocMetaFromUser(doc: FirestoreUserDoc, key: VctDocKey): ProductFileMeta | null {
  const prefix = DOC_FIELD_PREFIX[key];
  const url = doc[`${prefix}Url` as keyof FirestoreUserDoc] as string | undefined;
  if (!url) return null;
  return {
    url,
    path: (doc[`${prefix}Path` as keyof FirestoreUserDoc] as string) || '',
    name: (doc[`${prefix}Name` as keyof FirestoreUserDoc] as string) || 'Document',
    contentType: (doc[`${prefix}ContentType` as keyof FirestoreUserDoc] as string) || '',
  };
}

export function vctDocFieldsFromMeta(key: VctDocKey, meta: ProductFileMeta | null): Partial<FirestoreUserDoc> {
  const prefix = DOC_FIELD_PREFIX[key];
  if (!meta) {
    return {
      [`${prefix}Url`]: undefined,
      [`${prefix}Path`]: undefined,
      [`${prefix}Name`]: undefined,
      [`${prefix}ContentType`]: undefined,
    } as Partial<FirestoreUserDoc>;
  }
  return {
    [`${prefix}Url`]: meta.url,
    [`${prefix}Path`]: meta.path,
    [`${prefix}Name`]: meta.name,
    [`${prefix}ContentType`]: meta.contentType,
  } as Partial<FirestoreUserDoc>;
}

export type VctProfileInput = {
  username: string;
  phone: string;
  address: string;
  pincode: string;
  policeStation: string;
  secondaryContactName: string;
  secondaryContactRelationship: string;
  secondaryContactPhone: string;
};

export function validateVctProfile(input: VctProfileInput): string | null {
  if (!input.username.trim()) return 'Full name is required.';
  if (!isValidPhone(input.phone)) return 'Mobile number must be exactly 10 digits.';
  if (!input.address.trim()) return 'Residential address is required.';
  if (!isValidPincode(input.pincode)) return 'PIN code must be exactly 6 digits.';
  if (!input.policeStation.trim()) return 'Police station is required.';
  if (!input.secondaryContactName.trim()) return 'Emergency contact name is required.';
  if (!input.secondaryContactRelationship.trim()) return 'Relationship to emergency contact is required.';
  if (!isValidPhone(input.secondaryContactPhone)) {
    return 'Emergency contact phone must be exactly 10 digits.';
  }
  return null;
}

export function buildVctProfileFields(input: VctProfileInput): Pick<
  FirestoreUserDoc,
  | 'username'
  | 'phone'
  | 'address'
  | 'pincode'
  | 'policeStation'
  | 'secondaryContactName'
  | 'secondaryContactRelationship'
  | 'secondaryContactPhone'
> {
  return {
    username: input.username.trim(),
    phone: normalizePhone(input.phone),
    address: input.address.trim(),
    pincode: normalizePincode(input.pincode),
    policeStation: input.policeStation.trim(),
    secondaryContactName: input.secondaryContactName.trim(),
    secondaryContactRelationship: input.secondaryContactRelationship.trim(),
    secondaryContactPhone: normalizePhone(input.secondaryContactPhone),
  };
}

export function requireVctDocuments(
  biodata: ProductFileMeta | null,
  educationCert: ProductFileMeta | null,
  pcc: ProductFileMeta | null,
): string | null {
  if (!biodata) return 'Biodata document is required.';
  if (!educationCert) return 'Education certificate is required.';
  if (!pcc) return 'Police clearance certificate (PCC) is required.';
  return null;
}
