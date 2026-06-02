import type { Customer, FirestoreUserDoc, SiteCalibration } from '../types';
import { inferVerificationSubject } from './siteCalibrationProfileFields';

export const VERIFICATION_LIST_ACCENTS = ['emerald', 'violet', 'amber', 'blue'] as const;
export type VerificationListAccent = (typeof VERIFICATION_LIST_ACCENTS)[number];

export interface VerificationPartyPhoto {
  partyPhotoUrl?: string;
  partyPhotoPath?: string;
}

export function verificationListAccentClass(id: string): `verification-list-accent--${VerificationListAccent}` {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i)) % VERIFICATION_LIST_ACCENTS.length;
  }
  return `verification-list-accent--${VERIFICATION_LIST_ACCENTS[hash]}`;
}

export function verificationPartyPhotoForRecord(
  record: SiteCalibration,
  options: {
    rcProfile?: Pick<FirestoreUserDoc, 'profilePhotoUrl' | 'profilePhotoPath'> | null;
    rcUsersById?: Map<string, Pick<FirestoreUserDoc, 'profilePhotoUrl' | 'profilePhotoPath'>>;
    customersById?: Map<string, Customer>;
  },
): VerificationPartyPhoto {
  const subject = inferVerificationSubject(record);

  if (subject === 'self') {
    const rc =
      options.rcProfile ??
      (record.rcId ? options.rcUsersById?.get(record.rcId) : undefined);
    return {
      partyPhotoUrl: rc?.profilePhotoUrl,
      partyPhotoPath: rc?.profilePhotoPath,
    };
  }

  const customer = record.customerId ? options.customersById?.get(record.customerId) : undefined;
  return {
    partyPhotoUrl: customer?.shopPhotoUrl || customer?.customerPhotoUrl,
    partyPhotoPath: customer?.shopPhotoPath || customer?.customerPhotoPath,
  };
}

export function enrichVerificationListRecords<T extends SiteCalibration>(
  records: T[],
  options: Parameters<typeof verificationPartyPhotoForRecord>[1],
): (T & VerificationPartyPhoto)[] {
  return records.map(record => ({
    ...record,
    ...verificationPartyPhotoForRecord(record, options),
  }));
}
