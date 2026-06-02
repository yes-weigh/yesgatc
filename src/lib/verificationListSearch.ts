import type { SiteCalibration } from '../types';

export type VerificationSearchExtras = {
  rcCenterName?: string;
};

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Match verification rows against customer, serial, certificate, product, RC, VCT, or record id. */
export function matchesVerificationSearch(
  record: SiteCalibration,
  query: string,
  extras: VerificationSearchExtras = {},
): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return true;

  const haystack = [
    record.id,
    record.customerName,
    record.serialNumber,
    record.certificateNumber,
    record.applicationNumber,
    record.productName,
    record.vctName,
    record.vctId,
    extras.rcCenterName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}
