import type { ImageCaptureFacing } from './imageCapture';
import type { ProductFileMeta } from './productApprovalUpload';
import {
  emptyDeviceImageSlot,
  validateDeviceImageSlot,
  type DeviceImageSlotState,
} from './verificationDeviceImages';
import type { JobType, SiteCalibration } from '../types';
import { isVerificationCaptureDevice } from './verificationDevicePolicy';

export type PerformerPhotoKind = 'selfieWithId' | 'idAadhaar';

export type PerformerPhotosState = Record<PerformerPhotoKind, DeviceImageSlotState>;

export const PERFORMER_PHOTO_KINDS: PerformerPhotoKind[] = ['selfieWithId', 'idAadhaar'];

export const PERFORMER_PHOTO_CONFIG: Record<
  PerformerPhotoKind,
  {
    label: string;
    hint: string;
    storageFolder: string;
    defaultName: string;
    cameraFacing: ImageCaptureFacing;
  }
> = {
  selfieWithId: {
    label: 'Selfie wearing GATC ID card',
    hint: 'Use your front camera. Your face and GATC ID badge must both be clearly visible.',
    storageFolder: 'performer-selfie-id',
    defaultName: 'Selfie with GATC ID',
    cameraFacing: 'user',
  },
  idAadhaar: {
    label: 'Aadhaar card and GATC ID (one photo)',
    hint: 'One live photo with your Aadhaar card and GATC ID badge together. All text must be readable.',
    storageFolder: 'performer-id-aadhaar',
    defaultName: 'Aadhaar and GATC ID',
    cameraFacing: 'environment',
  },
};

type PerformerPhotoFieldKeys = {
  url: keyof SiteCalibration;
  path: keyof SiteCalibration;
  name: keyof SiteCalibration;
  contentType: keyof SiteCalibration;
};

const PERFORMER_PHOTO_FIELD_KEYS: Record<PerformerPhotoKind, PerformerPhotoFieldKeys> = {
  selfieWithId: {
    url: 'performerSelfieIdImageUrl',
    path: 'performerSelfieIdImagePath',
    name: 'performerSelfieIdImageName',
    contentType: 'performerSelfieIdImageContentType',
  },
  idAadhaar: {
    url: 'performerIdAadhaarImageUrl',
    path: 'performerIdAadhaarImagePath',
    name: 'performerIdAadhaarImageName',
    contentType: 'performerIdAadhaarImageContentType',
  },
};

export function emptyPerformerPhotosState(): PerformerPhotosState {
  return {
    selfieWithId: emptyDeviceImageSlot(),
    idAadhaar: emptyDeviceImageSlot(),
  };
}

export function performerPhotoMetaFromRecord(
  record: SiteCalibration,
  kind: PerformerPhotoKind,
): ProductFileMeta | null {
  const keys = PERFORMER_PHOTO_FIELD_KEYS[kind];
  const url = (record[keys.url] as string | undefined)?.trim() ?? '';
  const path = (record[keys.path] as string | undefined)?.trim() ?? '';
  if (!url && !path) return null;
  return {
    url,
    path,
    name: (record[keys.name] as string) || PERFORMER_PHOTO_CONFIG[kind].defaultName,
    contentType: (record[keys.contentType] as string) || 'image/jpeg',
  };
}

export function performerPhotosFromRecord(record: SiteCalibration): PerformerPhotosState {
  const state = emptyPerformerPhotosState();
  for (const kind of PERFORMER_PHOTO_KINDS) {
    const meta = performerPhotoMetaFromRecord(record, kind);
    if (meta) state[kind].file = meta;
  }
  return state;
}

export function performerPhotoFieldsFromMeta(
  kind: PerformerPhotoKind,
  meta: ProductFileMeta | null,
): Partial<SiteCalibration> {
  const keys = PERFORMER_PHOTO_FIELD_KEYS[kind];
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

export function requiresPerformerIdentityPhotos(
  verificationType: JobType | '' | undefined,
): boolean {
  return verificationType === 'RV' && isVerificationCaptureDevice();
}

export function validatePerformerPhotos(photos: PerformerPhotosState): string | null {
  for (const kind of PERFORMER_PHOTO_KINDS) {
    const error = validateDeviceImageSlot(
      photos[kind],
      PERFORMER_PHOTO_CONFIG[kind].label,
    );
    if (error) return error;
  }
  return null;
}

export function recordHasPerformerPhotos(
  record: Pick<
    SiteCalibration,
    | 'performerSelfieIdImageUrl'
    | 'performerSelfieIdImagePath'
    | 'performerIdAadhaarImageUrl'
    | 'performerIdAadhaarImagePath'
  >,
): boolean {
  const selfie =
    Boolean(record.performerSelfieIdImageUrl?.trim() || record.performerSelfieIdImagePath?.trim());
  const idAadhaar =
    Boolean(record.performerIdAadhaarImageUrl?.trim() || record.performerIdAadhaarImagePath?.trim());
  return selfie && idAadhaar;
}
