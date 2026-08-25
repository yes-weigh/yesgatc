/** Public eMAAP third-party certificate PDF (QR / share target). */
export function isEmaapCertificatePdfUrl(url?: string | null): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.includes('thirpartycertificate') ||
    lower.includes('thirdpartycertificate') ||
    lower.includes('gatcapi') ||
    (lower.includes('emaap.gov.in') && lower.includes('certificate'))
  );
}

function stripUrlHash(url: string): string {
  const hash = url.indexOf('#');
  return hash >= 0 ? url.slice(0, hash) : url;
}

function asFirestoreString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value && typeof value === 'object' && 'stringValue' in value) {
    const nested = (value as { stringValue?: unknown }).stringValue;
    if (typeof nested === 'string') {
      const trimmed = nested.trim();
      return trimmed || null;
    }
  }
  return null;
}

/** `siteCalibrations.emaapCertificatePdfUrl` — original eMAAP QR payload. */
export function readEmaapCertificatePdfUrl(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  for (const [key, value] of Object.entries(data)) {
    if (key.toLowerCase() !== 'emaapcertificatepdfurl') continue;
    const text = asFirestoreString(value);
    if (text) return stripUrlHash(text);
  }
  return null;
}

/**
 * QR / WhatsApp verify URL — Firestore `emaapCertificatePdfUrl` only.
 * Same payload eMAAP prints on the certificate QR.
 */
export function buildCertificateVerifyUrl(record: {
  emaapCertificatePdfUrl?: string | null;
}): string | null {
  const fromField = asFirestoreString(record.emaapCertificatePdfUrl);
  const url = fromField
    ? stripUrlHash(fromField)
    : readEmaapCertificatePdfUrl(record as unknown as Record<string, unknown>);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}
