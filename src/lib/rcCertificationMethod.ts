import type { FirestoreUserDoc, Role } from '../types';

export const RC_CERTIFICATION_METHODS = ['auto_dsc', 'pdf_signer', 'manual_upload'] as const;

export type RcCertificationMethod = (typeof RC_CERTIFICATION_METHODS)[number];

export const RC_CERTIFICATION_METHOD_OPTIONS: ReadonlyArray<{
  id: RcCertificationMethod;
  label: string;
}> = [
  { id: 'auto_dsc', label: 'Auto DSC engine' },
  { id: 'pdf_signer', label: 'PDF signer' },
  { id: 'manual_upload', label: 'Manual upload' },
];

export const DEFAULT_RC_CERTIFICATION_METHOD: RcCertificationMethod = 'auto_dsc';

export function isRcCertificationMethod(value: unknown): value is RcCertificationMethod {
  return RC_CERTIFICATION_METHODS.includes(value as RcCertificationMethod);
}

export function rcCertificationMethodFromUser(
  doc: Pick<FirestoreUserDoc, 'certificationMethod'> | null | undefined,
): RcCertificationMethod {
  return isRcCertificationMethod(doc?.certificationMethod)
    ? doc.certificationMethod
    : DEFAULT_RC_CERTIFICATION_METHOD;
}

export function rcCertificationMethodLabel(
  doc: Pick<FirestoreUserDoc, 'certificationMethod'> | null | undefined,
): string {
  const id = rcCertificationMethodFromUser(doc);
  return RC_CERTIFICATION_METHOD_OPTIONS.find(option => option.id === id)?.label ?? 'Auto DSC engine';
}

export function canEditRcCertificationSettings(user: {
  role?: Role | null;
} | null): boolean {
  return user?.role === 'super_admin';
}
