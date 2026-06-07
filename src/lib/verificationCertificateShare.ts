import { getBytes, ref } from 'firebase/storage';
import { legacyStorage, storage } from '../firebase';
import { normalizePhone } from './contactFields';
import { canDownloadVerificationCertificate } from './verificationRequest';
import type { SiteCalibration } from '../types';

const storageBackends = [storage, legacyStorage] as const;

export function canShareVerificationCertificatePdf(record: SiteCalibration): boolean {
  return canDownloadVerificationCertificate(record);
}

function certificatePdfFileName(record: SiteCalibration): string {
  const stored = record.certificatePdfName?.trim();
  if (stored) return stored.toLowerCase().endsWith('.pdf') ? stored : `${stored}.pdf`;

  const certNo = record.certificateNumber?.trim().replace(/[^\w.-]+/g, '_') || 'certificate';
  return `${certNo}.pdf`;
}

async function fetchCertificatePdfBytes(record: SiteCalibration): Promise<Uint8Array> {
  const storagePath = record.certificatePdfPath?.trim();
  if (storagePath) {
    let lastError: unknown;
    for (const backend of storageBackends) {
      try {
        return new Uint8Array(await getBytes(ref(backend, storagePath)));
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
  }

  const downloadUrl = record.certificatePdfUrl?.trim();
  if (downloadUrl) {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error('Could not download certificate PDF.');
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  throw new Error('Certificate PDF is not available.');
}

export async function buildVerificationCertificatePdfFile(
  record: SiteCalibration,
): Promise<File> {
  const bytes = await fetchCertificatePdfBytes(record);
  const fileName = certificatePdfFileName(record);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], fileName, { type: 'application/pdf' });
}

function canShareCertificatePdfFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

function openWhatsAppChat(phone?: string | null): void {
  const digits = phone ? normalizePhone(phone) : '';
  const url = digits.length === 10 ? `https://wa.me/91${digits}` : 'https://wa.me/';
  window.open(url, '_blank', 'noopener,noreferrer');
}

function downloadCertificatePdf(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type ShareVerificationCertificateResult = 'shared' | 'downloaded';

export async function shareVerificationCertificateOnWhatsApp(options: {
  record: SiteCalibration;
  phone?: string | null;
}): Promise<ShareVerificationCertificateResult> {
  if (!canShareVerificationCertificatePdf(options.record)) {
    throw new Error('Certificate PDF is not available to share yet.');
  }

  const file = await buildVerificationCertificatePdfFile(options.record);

  if (canShareCertificatePdfFile(file)) {
    await navigator.share({
      files: [file],
      title: 'Verification certificate',
    });
    return 'shared';
  }

  downloadCertificatePdf(file);
  openWhatsAppChat(options.phone);
  return 'downloaded';
}

export function formatCertificateShareError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Share cancelled.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Could not share certificate PDF. Try again.';
}
