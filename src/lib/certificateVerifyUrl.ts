/** Public eMAAP third-party certificate PDF (QR / share target). */
export function isEmaapCertificatePdfUrl(url?: string | null): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.includes('thirpartycertificate') ||
    lower.includes('thirdpartycertificate') ||
    (lower.includes('gatcapi') && lower.includes('.pdf'))
  );
}

/**
 * QR / WhatsApp verify URL — eMAAP gatcapi PDF only.
 * Cannot be rebuilt from certificate number; worker must persist `emaapCertificatePdfUrl`.
 */
export function buildCertificateVerifyUrl(record: {
  emaapCertificatePdfUrl?: string | null;
}): string | null {
  const url = record.emaapCertificatePdfUrl?.trim();
  if (!url || !isEmaapCertificatePdfUrl(url)) return null;
  const hash = url.indexOf('#');
  return hash >= 0 ? url.slice(0, hash) : url;
}
