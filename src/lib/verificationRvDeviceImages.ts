import type { SiteCalibration } from '../types';
import type { ProductFileMeta } from './productApprovalUpload';
import {
  emptyDeviceImageSlot,
  validateDeviceImageSlot,
  type DeviceImageSlotState,
} from './verificationDeviceImages';

export type RvDocumentKind = 'oldCertificate' | 'oldInvoice';

export type DeviceRvDocumentsState = {
  oldCertificate: DeviceImageSlotState;
  oldInvoice: DeviceImageSlotState;
};

export const RV_DOCUMENT_KINDS: RvDocumentKind[] = ['oldCertificate', 'oldInvoice'];

export const RV_DOCUMENT_CONFIG: Record<
  RvDocumentKind,
  {
    label: string;
    shortLabel: string;
    hint: string;
    storageFolder: string;
    defaultName: string;
  }
> = {
  oldCertificate: {
    label: 'Old verification certificate',
    shortLabel: 'Old certificate',
    hint: 'Required for re-verification submit',
    storageFolder: 'old-verification-certificate',
    defaultName: 'Old verification certificate',
  },
  oldInvoice: {
    label: 'Old invoice',
    shortLabel: 'Old invoice',
    hint: 'Optional',
    storageFolder: 'old-invoice',
    defaultName: 'Old invoice',
  },
};

/** RV submit requires previous certificate only — old invoice is optional. */
export function requiredRvDocumentKinds(): RvDocumentKind[] {
  return ['oldCertificate'];
}

export function isRvDocumentRequired(kind: RvDocumentKind): boolean {
  return requiredRvDocumentKinds().includes(kind);
}

type DocumentFieldKeys = {
  url: keyof SiteCalibration;
  path: keyof SiteCalibration;
  name: keyof SiteCalibration;
  contentType: keyof SiteCalibration;
};

const DOCUMENT_FIELD_KEYS: Record<RvDocumentKind, DocumentFieldKeys> = {
  oldCertificate: {
    url: 'oldVerificationCertificateUrl',
    path: 'oldVerificationCertificatePath',
    name: 'oldVerificationCertificateName',
    contentType: 'oldVerificationCertificateContentType',
  },
  oldInvoice: {
    url: 'oldInvoiceUrl',
    path: 'oldInvoicePath',
    name: 'oldInvoiceName',
    contentType: 'oldInvoiceContentType',
  },
};

export function emptyDeviceRvDocumentsState(): DeviceRvDocumentsState {
  return {
    oldCertificate: emptyDeviceImageSlot(),
    oldInvoice: emptyDeviceImageSlot(),
  };
}

export function deviceRvDocumentsFromRows(
  rows: { localId: string }[],
): Record<string, DeviceRvDocumentsState> {
  return Object.fromEntries(rows.map(row => [row.localId, emptyDeviceRvDocumentsState()]));
}

export function rvDocumentMetaFromRecord(
  record: SiteCalibration,
  kind: RvDocumentKind,
): ProductFileMeta | null {
  const keys = DOCUMENT_FIELD_KEYS[kind];
  const url = record[keys.url] as string | undefined;
  if (!url) return null;
  return {
    url,
    path: (record[keys.path] as string) || '',
    name: (record[keys.name] as string) || RV_DOCUMENT_CONFIG[kind].defaultName,
    contentType: (record[keys.contentType] as string) || 'image/jpeg',
  };
}

export function rvDocumentsFromRecord(record: SiteCalibration): DeviceRvDocumentsState {
  const state = emptyDeviceRvDocumentsState();
  for (const kind of RV_DOCUMENT_KINDS) {
    const meta = rvDocumentMetaFromRecord(record, kind);
    if (meta) state[kind].file = meta;
  }
  return state;
}

export function rvDocumentFieldsFromMeta(
  kind: RvDocumentKind,
  meta: ProductFileMeta | null,
): Partial<SiteCalibration> {
  const keys = DOCUMENT_FIELD_KEYS[kind];
  if (!meta) {
    return {
      [keys.url]: '',
      [keys.path]: '',
      [keys.name]: '',
      [keys.contentType]: '',
    };
  }
  return {
    [keys.url]: meta.url,
    [keys.path]: meta.path,
    [keys.name]: meta.name,
    [keys.contentType]: meta.contentType,
  };
}

export function validateDeviceRvDocuments(
  documents: DeviceRvDocumentsState,
  deviceLabel: string,
): string | null {
  for (const kind of requiredRvDocumentKinds()) {
    const error = validateDeviceImageSlot(
      documents[kind],
      `${deviceLabel}: ${RV_DOCUMENT_CONFIG[kind].label}`,
    );
    if (error) return error;
  }
  return null;
}

export function manufacturingYearOptions(span = 15): number[] {
  const current = new Date().getFullYear();
  return Array.from({ length: span + 1 }, (_, index) => current - index);
}

export function isValidManufacturingYear(year: string): boolean {
  const trimmed = year.trim();
  if (!trimmed) return false;
  const value = Number(trimmed);
  if (!Number.isInteger(value)) return false;
  return manufacturingYearOptions().includes(value);
}

export function manufacturingYearLabel(year: string | number | undefined): string {
  if (year === undefined || year === null || year === '') return '—';
  return String(year);
}
