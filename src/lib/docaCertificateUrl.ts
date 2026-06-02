const DOCA_CERTIFICATE_VIEW_BASE =
  'https://doca.gov.in/gatc/viewinstrumentcertificateSingle?certificate=';

/** Public DOCA certificate page — certificate param is URL-encoded (e.g. IND/GATC/KL/26/04/26/1143). */
export function buildDocaCertificateViewUrl(
  certificateNumber: string | undefined | null,
): string | null {
  const trimmed = certificateNumber?.trim();
  if (!trimmed) return null;
  return `${DOCA_CERTIFICATE_VIEW_BASE}${encodeURIComponent(trimmed)}`;
}
