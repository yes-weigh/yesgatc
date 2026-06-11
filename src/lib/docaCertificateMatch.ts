import type { DocaCertificateRecord } from './docaScraping';

/** Normalize certificate numbers for comparison across DOCA scrape and site verifications. */
export function normalizeCertificateMatchKey(value: string | undefined | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, '').toUpperCase();
}

export function isDocaCertificateInVerifications(
  record: DocaCertificateRecord,
  verificationCertificateNumbers: ReadonlySet<string>,
): boolean {
  if (verificationCertificateNumbers.size === 0) {
    return false;
  }

  const generateKey = normalizeCertificateMatchKey(record.generateCertificate);
  if (generateKey && verificationCertificateNumbers.has(generateKey)) {
    return true;
  }

  const gatcKey = normalizeCertificateMatchKey(record.gatcCertificateNo);
  return Boolean(gatcKey && verificationCertificateNumbers.has(gatcKey));
}

export function countDocaCertificatesInVerifications(
  records: DocaCertificateRecord[],
  verificationCertificateNumbers: ReadonlySet<string>,
): number {
  return records.filter(record =>
    isDocaCertificateInVerifications(record, verificationCertificateNumbers),
  ).length;
}
