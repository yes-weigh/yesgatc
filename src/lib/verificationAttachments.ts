import {
  imageMetaFromRecord,
  VERIFICATION_IMAGE_CONFIG,
  ALL_STORED_VERIFICATION_IMAGE_KINDS,
  type VerificationImageKind,
} from './verificationDeviceImages';
import {
  RV_DOCUMENT_CONFIG,
  RV_DOCUMENT_KINDS,
  rvDocumentMetaFromRecord,
  type RvDocumentKind,
} from './verificationRvDeviceImages';
import type { SiteCalibration } from '../types';

export type VerificationAttachmentItem = {
  id: VerificationImageKind | RvDocumentKind;
  label: string;
  url: string;
  path: string;
};

export function listVerificationAttachmentsFromRecord(
  record: SiteCalibration,
): VerificationAttachmentItem[] {
  const items: VerificationAttachmentItem[] = [];

  for (const kind of ALL_STORED_VERIFICATION_IMAGE_KINDS) {
    if (kind === 'instrumentRear' && record.verificationType !== 'RV') continue;
    const meta = imageMetaFromRecord(record, kind);
    if (!meta) continue;
    items.push({
      id: kind,
      label: VERIFICATION_IMAGE_CONFIG[kind].shortLabel,
      url: meta.url,
      path: meta.path,
    });
  }

  if (record.verificationType === 'RV') {
    for (const kind of RV_DOCUMENT_KINDS) {
      const meta = rvDocumentMetaFromRecord(record, kind);
      if (!meta) continue;
      items.push({
        id: kind,
        label: RV_DOCUMENT_CONFIG[kind].shortLabel,
        url: meta.url,
        path: meta.path,
      });
    }
  }

  return items;
}
