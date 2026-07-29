import { normalizePhone } from './contactFields';
import { buildCertificateVerifyUrl } from './certificateVerifyUrl';

export function buildVerificationWhatsAppShareMessage(
  record: {
    customerName?: string;
    certificateNumber?: string;
    applicationNumber?: string;
    serialNumber?: string;
    emaapCertificatePdfUrl?: string;
  },
): string {
  const certificateViewUrl = buildCertificateVerifyUrl(record);
  const lines = ['Certificate of Verification'];
  if (record.customerName?.trim()) {
    lines.push(`Customer: ${record.customerName.trim()}`);
  }
  if (record.certificateNumber?.trim()) {
    lines.push(`Certificate: ${record.certificateNumber.trim()}`);
  }
  if (record.applicationNumber?.trim()) {
    lines.push(`Application: ${record.applicationNumber.trim()}`);
  }
  if (record.serialNumber?.trim()) {
    lines.push(`Serial: ${record.serialNumber.trim()}`);
  }
  if (certificateViewUrl) {
    lines.push(certificateViewUrl);
  }
  return lines.join('\n');
}

export function buildWhatsAppShareUrl(text: string, phone?: string | null): string {
  const encoded = encodeURIComponent(text);
  const digits = phone ? normalizePhone(phone) : '';
  if (digits.length === 10) {
    return `https://wa.me/91${digits}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
}
