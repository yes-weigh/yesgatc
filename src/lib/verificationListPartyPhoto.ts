import type { Customer, FirestoreUserDoc, SiteCalibration } from '../types';
import { inferVerificationSubject } from './siteCalibrationProfileFields';

export interface VerificationPartyPhoto {
  partyPhotoUrl?: string;
  partyPhotoPath?: string;
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
