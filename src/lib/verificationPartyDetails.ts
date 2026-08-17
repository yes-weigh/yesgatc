import type { Customer, FirestoreUserDoc, Product, SiteCalibration } from '../types';
import { inferVerificationSubject } from './siteCalibrationProfileFields';
import { KERALA_STATE } from './keralaRegion';

export type VerificationRcPartyProfile = Pick<
  FirestoreUserDoc,
  'companyName' | 'contactPerson' | 'address' | 'pincode' | 'place' | 'phone'
>;

export type VerificationPartyDetails = {
  kind: 'customer' | 'self';
  name: string;
  address: string;
  pincode: string;
  district: string;
  state: string;
  phone: string;
};

function text(value?: string | null): string {
  return value?.trim() || '';
}

export function resolveVerificationParty(
  record: SiteCalibration,
  options: {
    customer?: Customer | null;
    rc?: VerificationRcPartyProfile | null;
  } = {},
): VerificationPartyDetails {
  const kind =
    record.fileCertificateAsRc || inferVerificationSubject(record) === 'self' ? 'self' : 'customer';
  if (kind === 'self') {
    const rc = options.rc;
    return {
      kind,
      name: text(rc?.companyName) || text(record.customerName) || 'RC centre',
      address: text(rc?.address),
      pincode: text(rc?.pincode),
      district: text(rc?.place),
      state: KERALA_STATE,
      phone: text(rc?.phone),
    };
  }

  const customer = options.customer;
  return {
    kind,
    name: text(customer?.name) || text(record.customerName),
    address: text(customer?.address),
    pincode: text(customer?.pincode),
    district: text(customer?.district),
    state: text(customer?.state),
    phone: text(customer?.phone),
  };
}

export function verificationListPartyName(
  record: Pick<SiteCalibration, 'customerName' | 'fileCertificateAsRc'>,
  rcCenterName?: string,
): string {
  if (record.fileCertificateAsRc) {
    return text(record.customerName) || text(rcCenterName) || '—';
  }
  return text(record.customerName) || '—';
}

export function resolveVerificationProduct(record: SiteCalibration, product?: Product | null) {
  return {
    name: text(record.productName) || text(product?.name),
    modelApprovalNo: text(product?.modelApprovalNo),
    manufacturer: text(product?.manufacturerBrandSeries),
    accuracyClass: text(product?.accuracyClass),
  };
}
