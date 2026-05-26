import type { SiteCalibration } from '../types';
import type { ProductFileMeta } from './productApprovalUpload';

export type VerificationImageKind = 'scale' | 'stamping' | 'standardWeight';

export type DeviceImageSlotState = {
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
  pendingFile: File | null;
  removed: boolean;
};

export type DeviceVerificationImagesState = {
  scale: DeviceImageSlotState;
  stamping: DeviceImageSlotState;
  standardWeight: DeviceImageSlotState;
};

export const VERIFICATION_IMAGE_KINDS: VerificationImageKind[] = [
  'scale',
  'stamping',
  'standardWeight',
];

export const VERIFICATION_IMAGE_CONFIG: Record<
  VerificationImageKind,
  {
    label: string;
    hint: string;
    placeholderSrc: string;
    storageFolder: string;
    defaultName: string;
  }
> = {
  scale: {
    label: 'Scale image',
    hint: 'Required for submit',
    placeholderSrc: '/verification/scaleimagelogo.png',
    storageFolder: 'scale-image',
    defaultName: 'Scale image',
  },
  stamping: {
    label: 'Stamping image',
    hint: 'Required for submit',
    placeholderSrc: '/verification/sealimagelogo.png',
    storageFolder: 'stamping-image',
    defaultName: 'Stamping image',
  },
  standardWeight: {
    label: 'With standard weight image',
    hint: 'Required for submit',
    placeholderSrc: '/verification/withweightlogo.png',
    storageFolder: 'standard-weight-image',
    defaultName: 'With standard weight image',
  },
};

type ImageFieldKeys = {
  url: keyof SiteCalibration;
  path: keyof SiteCalibration;
  name: keyof SiteCalibration;
  contentType: keyof SiteCalibration;
};

const IMAGE_FIELD_KEYS: Record<VerificationImageKind, ImageFieldKeys> = {
  scale: {
    url: 'scaleImageUrl',
    path: 'scaleImagePath',
    name: 'scaleImageName',
    contentType: 'scaleImageContentType',
  },
  stamping: {
    url: 'stampingImageUrl',
    path: 'stampingImagePath',
    name: 'stampingImageName',
    contentType: 'stampingImageContentType',
  },
  standardWeight: {
    url: 'standardWeightImageUrl',
    path: 'standardWeightImagePath',
    name: 'standardWeightImageName',
    contentType: 'standardWeightImageContentType',
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
    scale: emptyDeviceImageSlot(),
    stamping: emptyDeviceImageSlot(),
    standardWeight: emptyDeviceImageSlot(),
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
  const url = record[keys.url] as string | undefined;
  if (!url) return null;
  return {
    url,
    path: (record[keys.path] as string) || '',
    name: (record[keys.name] as string) || VERIFICATION_IMAGE_CONFIG[kind].defaultName,
    contentType: (record[keys.contentType] as string) || 'image/jpeg',
  };
}

export function verificationImagesFromRecord(record: SiteCalibration): DeviceVerificationImagesState {
  const state = emptyDeviceVerificationImagesState();
  for (const kind of VERIFICATION_IMAGE_KINDS) {
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
): string | null {
  for (const kind of VERIFICATION_IMAGE_KINDS) {
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
