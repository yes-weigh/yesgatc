/**
 * Zoho invoice ORDER NUMBER (reference_number) from certificate number.
 * IND/GATC/KL/26/04/26/1271 → 26/1271 (last two slash segments).
 */
export function zohoInvoiceOrderReferenceFromCertificate(
  certificateNumber: string | null | undefined,
): string | null {
  const trimmed = certificateNumber?.trim() ?? '';
  if (!trimmed) return null;

  const parts = trimmed.split('/').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const secondLast = parts[parts.length - 2];
  const last = parts[parts.length - 1];
  if (!secondLast || !last) return null;

  return `${secondLast}/${last}`;
}
