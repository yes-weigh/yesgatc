import { isValidPincode, normalizePincode } from './contactFields';
import type { CustomerFormValues } from './customerProfileFields';
import type { JobType, SiteCalibration } from '../types';
import {
  ALL_STORED_VERIFICATION_IMAGE_KINDS,
  emptyDeviceVerificationImagesState,
  imageMetaFromRecord,
  requiredVerificationImageKinds,
  VERIFICATION_IMAGE_CONFIG,
  type DeviceVerificationImagesState,
} from './verificationDeviceImages';
import {
  emptyDeviceRvDocumentsState,
  requiredRvDocumentKinds,
  rvDocumentMetaFromRecord,
  RV_DOCUMENT_CONFIG,
  type DeviceRvDocumentsState,
} from './verificationRvDeviceImages';
import {
  emptyPerformerPhotosState,
  PERFORMER_PHOTO_CONFIG,
  PERFORMER_PHOTO_KINDS,
  performerPhotoMetaFromRecord,
  requiresPerformerIdentityPhotos,
  type PerformerPhotosState,
} from './verificationPerformerPhotos';

export const VERIFICATION_OFFLINE_SUBMIT_MESSAGE =
  'Connect to the internet to upload photos and submit for certification.';

export const VERIFICATION_PINCODE_REQUIRED_MESSAGE =
  'Postal code is required. Enter a valid 6-digit PIN and wait for district and state.';

export const VERIFICATION_UPLOADS_IN_PROGRESS_MESSAGE =
  'Wait for photo uploads to finish before submitting.';

function slotUploading(slot: { uploading?: boolean } | null | undefined): boolean {
  return Boolean(slot?.uploading);
}

function slotHasPending(slot: { pendingFile?: File | null } | null | undefined): boolean {
  return Boolean(slot?.pendingFile);
}

function slotHasDurableUpload(slot: {
  removed?: boolean;
  file?: { url?: string; path?: string } | null;
} | null | undefined): boolean {
  if (!slot || slot.removed) return false;
  const url = slot.file?.url?.trim() ?? '';
  const path = slot.file?.path?.trim() ?? '';
  if (url.startsWith('blob:')) return false;
  return Boolean(url || path);
}

export function verificationOnlineBlockReason(): string | null {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return VERIFICATION_OFFLINE_SUBMIT_MESSAGE;
  }
  return null;
}

export function validatePincodePresent(pincode: string | null | undefined): string | null {
  if (!isValidPincode(normalizePincode(pincode ?? ''))) {
    return VERIFICATION_PINCODE_REQUIRED_MESSAGE;
  }
  return null;
}

export function validatePartyPincodeForSubmit(input: {
  verificationSubject: 'self' | 'customer' | '';
  customerForm?: CustomerFormValues | null;
  rcForm?: CustomerFormValues | null;
  /** Fallback when form is closed (list submit). */
  customerPincode?: string | null;
  rcPincode?: string | null;
}): string | null {
  if (input.verificationSubject === 'self') {
    const pin = input.rcForm?.pincode ?? input.rcPincode ?? '';
    const pinError = validatePincodePresent(pin);
    if (pinError) return pinError;
    const form = input.rcForm;
    if (form && (!form.state.trim() || !form.district.trim())) {
      return 'Complete postal code and wait for district and state before submitting.';
    }
    return null;
  }

  if (input.verificationSubject === 'customer') {
    const pin = input.customerForm?.pincode ?? input.customerPincode ?? '';
    const pinError = validatePincodePresent(pin);
    if (pinError) return pinError;
    const form = input.customerForm;
    if (form && (!form.state.trim() || !form.district.trim())) {
      return 'Complete postal code and wait for district and state before submitting.';
    }
    return null;
  }

  return null;
}

export function verificationUploadsInProgressBlockReason(
  deviceImages: Record<string, DeviceVerificationImagesState>,
  deviceRvImages: Record<string, DeviceRvDocumentsState> = {},
  performerPhotos?: PerformerPhotosState | null,
): string | null {
  for (const images of Object.values(deviceImages)) {
    for (const slot of Object.values(images)) {
      if (slotUploading(slot)) return VERIFICATION_UPLOADS_IN_PROGRESS_MESSAGE;
    }
  }
  for (const docs of Object.values(deviceRvImages)) {
    for (const slot of Object.values(docs)) {
      if (slotUploading(slot)) return VERIFICATION_UPLOADS_IN_PROGRESS_MESSAGE;
    }
  }
  if (performerPhotos) {
    for (const kind of PERFORMER_PHOTO_KINDS) {
      if (slotUploading(performerPhotos[kind])) return VERIFICATION_UPLOADS_IN_PROGRESS_MESSAGE;
    }
  }
  return null;
}

/** True when local files still need Firebase upload before submit can finish. */
export function verificationHasPendingUploads(
  deviceImages: Record<string, DeviceVerificationImagesState>,
  deviceRvImages: Record<string, DeviceRvDocumentsState> = {},
  performerPhotos?: PerformerPhotosState | null,
): boolean {
  for (const images of Object.values(deviceImages)) {
    for (const slot of Object.values(images)) {
      if (slotHasPending(slot)) return true;
    }
  }
  for (const docs of Object.values(deviceRvImages)) {
    for (const slot of Object.values(docs)) {
      if (slotHasPending(slot)) return true;
    }
  }
  if (performerPhotos) {
    for (const kind of PERFORMER_PHOTO_KINDS) {
      if (slotHasPending(performerPhotos[kind])) return true;
    }
  }
  return false;
}

/**
 * Submit requires durable Storage URLs (not blob / pending-only).
 * Use after save/upload, or for list submit of existing drafts.
 */
export function validateVerificationImagesUploaded(
  verificationType: JobType | '',
  deviceImages: Record<string, DeviceVerificationImagesState>,
  deviceLocalIds: string[],
  deviceRvImages: Record<string, DeviceRvDocumentsState> = {},
  performerPhotos?: PerformerPhotosState | null,
  options?: { skipPerformerPhotos?: boolean },
): string | null {
  for (let i = 0; i < deviceLocalIds.length; i += 1) {
    const localId = deviceLocalIds[i];
    const label = `Device ${i + 1}`;
    const images = deviceImages[localId] ?? emptyDeviceVerificationImagesState();
    for (const kind of requiredVerificationImageKinds(verificationType)) {
      if (!slotHasDurableUpload(images[kind])) {
        return `${label}: ${VERIFICATION_IMAGE_CONFIG[kind].label} must be uploaded before submit.`;
      }
    }
    if (verificationType === 'RV') {
      const docs = deviceRvImages[localId] ?? emptyDeviceRvDocumentsState();
      for (const kind of requiredRvDocumentKinds()) {
        if (!slotHasDurableUpload(docs[kind])) {
          return `${label}: ${RV_DOCUMENT_CONFIG[kind].label} must be uploaded before submit.`;
        }
      }
    }
  }

  if (
    requiresPerformerIdentityPhotos(verificationType)
    && !options?.skipPerformerPhotos
  ) {
    const photos = performerPhotos ?? emptyPerformerPhotosState();
    for (const kind of PERFORMER_PHOTO_KINDS) {
      if (!slotHasDurableUpload(photos[kind])) {
        return `${PERFORMER_PHOTO_CONFIG[kind].label} must be uploaded before submit.`;
      }
    }
  }

  return null;
}

/** Draft already saved — all required photos must exist on the Firestore record. */
export function validateRecordImagesUploaded(record: SiteCalibration): string | null {
  const images = emptyDeviceVerificationImagesState();
  for (const kind of ALL_STORED_VERIFICATION_IMAGE_KINDS) {
    const meta = imageMetaFromRecord(record, kind);
    if (meta) images[kind].file = meta;
  }

  const rvDocs = emptyDeviceRvDocumentsState();
  if (record.verificationType === 'RV') {
    for (const kind of requiredRvDocumentKinds()) {
      const meta = rvDocumentMetaFromRecord(record, kind);
      if (meta) rvDocs[kind].file = meta;
    }
  }

  const performer = emptyPerformerPhotosState();
  for (const kind of PERFORMER_PHOTO_KINDS) {
    const meta = performerPhotoMetaFromRecord(record, kind);
    if (meta) performer[kind].file = meta;
  }

  return validateVerificationImagesUploaded(
    record.verificationType ?? '',
    { [record.id]: images },
    [record.id],
    record.verificationType === 'RV' ? { [record.id]: rvDocs } : {},
    performer,
    { skipPerformerPhotos: !requiresPerformerIdentityPhotos(record.verificationType) },
  );
}
