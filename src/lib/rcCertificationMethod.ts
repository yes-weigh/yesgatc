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

/** Super Admin RC form. Manual upload is leftover data only — not selectable. */
export const RC_CERTIFICATION_METHOD_EDIT_OPTIONS = RC_CERTIFICATION_METHOD_OPTIONS.filter(
  option => option.id !== 'manual_upload',
);

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

/** Cash receipt only for Auto DSC / PDF signer — not Manual upload. */
export function rcAllowsCashReceipt(
  method: RcCertificationMethod | null | undefined,
): boolean {
  const id = method ?? DEFAULT_RC_CERTIFICATION_METHOD;
  return id === 'auto_dsc' || id === 'pdf_signer';
}

export function rcAllowsCashReceiptFromUser(
  doc: Pick<FirestoreUserDoc, 'certificationMethod'> | null | undefined,
): boolean {
  return rcAllowsCashReceipt(rcCertificationMethodFromUser(doc));
}

export function canEditRcCertificationSettings(user: {
  role?: Role | null;
} | null): boolean {
  return user?.role === 'super_admin';
}

export function rcUsesPdfSigner(
  doc: Pick<FirestoreUserDoc, 'certificationMethod' | 'emaapSignerType'> | null | undefined,
): boolean {
  if (rcCertificationMethodFromUser(doc) === 'auto_dsc') return false;
  return (
    doc?.certificationMethod === 'pdf_signer'
    || doc?.emaapSignerType === 'pdf_signer'
  );
}

export function rcUsesManualSignedUpload(
  doc: Pick<FirestoreUserDoc, 'certificationMethod' | 'emaapSignerType'> | null | undefined,
): boolean {
  return rcCertificationMethodFromUser(doc) === 'manual_upload' && !rcUsesPdfSigner(doc);
}
