import type { JobType, SiteCalibration } from '../types';
import type { ProductFileMeta } from './productApprovalUpload';

/** Internal storage keys — legacy `scale` / `stamping` / `standardWeight` unchanged for existing records. */
export type VerificationImageKind =
  | 'stamping'
  | 'scale'
  | 'instrumentRear'
  | 'standardWeight'
  | 'verificationSeal'
  | 'installation';

export type DeviceImageSlotState = {
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
  pendingFile: File | null;
  removed: boolean;
};

export type DeviceVerificationImagesState = {
  stamping: DeviceImageSlotState;
  scale: DeviceImageSlotState;
  instrumentRear: DeviceImageSlotState;
  standardWeight: DeviceImageSlotState;
  verificationSeal: DeviceImageSlotState;
  installation: DeviceImageSlotState;
};

/** Display order for original verification (OV). */
export const VERIFICATION_IMAGE_KINDS: VerificationImageKind[] = [
  'stamping',
  'scale',
  'standardWeight',
  'verificationSeal',
  'installation',
];

/** All image kinds persisted on a device record (includes RV-only slots). */
export const ALL_STORED_VERIFICATION_IMAGE_KINDS: VerificationImageKind[] = [
  ...VERIFICATION_IMAGE_KINDS,
  'instrumentRear',
];

/** Photo slots shown on the evidence step for the given verification type. */
export function verificationImageKindsForSession(
  verificationType?: JobType | '' | undefined,
): VerificationImageKind[] {
  if (verificationType === 'RV') {
    const kinds = [...VERIFICATION_IMAGE_KINDS];
    const scaleIndex = kinds.indexOf('scale');
    kinds.splice(scaleIndex + 1, 0, 'instrumentRear');
    return kinds;
  }
  return [...VERIFICATION_IMAGE_KINDS];
}

export const VERIFICATION_IMAGE_CONFIG: Record<
  VerificationImageKind,
  {
    label: string;
    shortLabel: string;
    hint: string;
    storageFolder: string;
    defaultName: string;
  }
> = {
  stamping: {
    label: 'Serial number plate photo',
    shortLabel: 'Serial plate',
    hint: 'Required for submit',
    storageFolder: 'stamping-image',
    defaultName: 'Stamping plate image',
  },
  scale: {
    label: 'Instrument front photo',
    shortLabel: 'Front',
    hint: 'Required for submit',
    storageFolder: 'scale-image',
    defaultName: 'Scale image',
  },
  instrumentRear: {
    label: 'Instrument rear photo',
    shortLabel: 'Rear',
    hint: 'Required for re-verification submit',
    storageFolder: 'instrument-rear-image',
    defaultName: 'Instrument rear photo',
  },
  standardWeight: {
    label: 'Testing photos',
    shortLabel: 'Testing',
    hint: 'Optional',
    storageFolder: 'standard-weight-image',
    defaultName: 'With standard weight image',
  },
  verificationSeal: {
    label: 'Verification seal photo',
    shortLabel: 'Seal',
    hint: 'Optional',
    storageFolder: 'verification-seal-image',
    defaultName: 'Verification seal photo',
  },
  installation: {
    label: 'Installation photo',
    shortLabel: 'Installation',
    hint: 'Optional',
    storageFolder: 'installation-image',
    defaultName: 'Installation photo',
  },
};

type ImageFieldKeys = {
  url: keyof SiteCalibration;
  path: keyof SiteCalibration;
  name: keyof SiteCalibration;
  contentType: keyof SiteCalibration;
};

const IMAGE_FIELD_KEYS: Record<VerificationImageKind, ImageFieldKeys> = {
  stamping: {
    url: 'stampingImageUrl',
    path: 'stampingImagePath',
    name: 'stampingImageName',
    contentType: 'stampingImageContentType',
  },
  scale: {
    url: 'scaleImageUrl',
    path: 'scaleImagePath',
    name: 'scaleImageName',
    contentType: 'scaleImageContentType',
  },
  instrumentRear: {
    url: 'instrumentRearImageUrl',
    path: 'instrumentRearImagePath',
    name: 'instrumentRearImageName',
    contentType: 'instrumentRearImageContentType',
  },
  standardWeight: {
    url: 'standardWeightImageUrl',
    path: 'standardWeightImagePath',
    name: 'standardWeightImageName',
    contentType: 'standardWeightImageContentType',
  },
  verificationSeal: {
    url: 'verificationSealImageUrl',
    path: 'verificationSealImagePath',
    name: 'verificationSealImageName',
    contentType: 'verificationSealImageContentType',
  },
  installation: {
    url: 'installationImageUrl',
    path: 'installationImagePath',
    name: 'installationImageName',
    contentType: 'installationImageContentType',
  },
};

export function emptyDeviceImageSlot(): DeviceImageSlotState {
  return {
    file: null,
    uploading: false,
    progress: 0,
    pendingFile: null,
    removed: false,
  };
}

export function emptyDeviceVerificationImagesState(): DeviceVerificationImagesState {
  return {
    stamping: emptyDeviceImageSlot(),
    scale: emptyDeviceImageSlot(),
    instrumentRear: emptyDeviceImageSlot(),
    standardWeight: emptyDeviceImageSlot(),
    verificationSeal: emptyDeviceImageSlot(),
    installation: emptyDeviceImageSlot(),
  };
}

export function deviceVerificationImagesFromRows(
  rows: { localId: string }[],
): Record<string, DeviceVerificationImagesState> {
  return Object.fromEntries(rows.map(row => [row.localId, emptyDeviceVerificationImagesState()]));
}

export function imageMetaFromRecord(
  record: SiteCalibration,
  kind: VerificationImageKind,
): ProductFileMeta | null {
  const keys = IMAGE_FIELD_KEYS[kind];
  const url = (record[keys.url] as string | undefined)?.trim() ?? '';
  const path = (record[keys.path] as string | undefined)?.trim() ?? '';
  if (!url && !path) return null;
  return {
    url,
    path,
    name: (record[keys.name] as string) || VERIFICATION_IMAGE_CONFIG[kind].defaultName,
    contentType: (record[keys.contentType] as string) || 'image/jpeg',
  };
}

export function verificationImagesFromRecord(record: SiteCalibration): DeviceVerificationImagesState {
  const state = emptyDeviceVerificationImagesState();
  for (const kind of ALL_STORED_VERIFICATION_IMAGE_KINDS) {
    const meta = imageMetaFromRecord(record, kind);
    if (meta) state[kind].file = meta;
  }
  return state;
}

export function imageFieldsFromMeta(
  kind: VerificationImageKind,
  meta: ProductFileMeta | null,
): Partial<SiteCalibration> {
  const keys = IMAGE_FIELD_KEYS[kind];
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

/** Serial plate + instrument front photo; rear photo additionally required for RV. */
export function requiredVerificationImageKinds(
  verificationType?: JobType | '' | undefined,
): VerificationImageKind[] {
  if (verificationType === 'RV') return ['stamping', 'scale', 'instrumentRear'];
  return ['stamping', 'scale'];
}

export function isVerificationImageRequired(
  kind: VerificationImageKind,
  verificationType?: JobType | '' | undefined,
): boolean {
  return requiredVerificationImageKinds(verificationType).includes(kind);
}

export function verificationImageHint(
  kind: VerificationImageKind,
  verificationType?: JobType | '' | undefined,
): string {
  if (isVerificationImageRequired(kind, verificationType)) {
    return kind === 'instrumentRear'
      ? 'Required for re-verification submit'
      : 'Required for submit';
  }
  return 'Optional';
}

export function validateDeviceImageSlot(
  slot: DeviceImageSlotState,
  imageLabel: string,
): string | null {
  if (slot.pendingFile) return null;
  if (!slot.removed && slot.file?.url && !slot.file.url.startsWith('blob:')) return null;
  return `${imageLabel} is required.`;
}

export function validateDeviceVerificationImages(
  images: DeviceVerificationImagesState,
  deviceLabel: string,
  verificationType?: JobType | '',
): string | null {
  for (const kind of requiredVerificationImageKinds(verificationType)) {
    const error = validateDeviceImageSlot(
      images[kind],
      `${deviceLabel}: ${VERIFICATION_IMAGE_CONFIG[kind].label}`,
    );
    if (error) return error;
  }
  return null;
}

/** @deprecated Use imageMetaFromRecord(record, 'scale') */
export function scaleImageFromRecord(record: SiteCalibration): ProductFileMeta | null {
  return imageMetaFromRecord(record, 'scale');
}

/** @deprecated Use imageFieldsFromMeta('scale', meta) */
export function scaleImageFieldsFromMeta(meta: ProductFileMeta | null): Partial<SiteCalibration> {
  return imageFieldsFromMeta('scale', meta);
}
