import { normalizePhone } from './contactFields';
import { buildCertificateVerifyUrl } from './certificateVerifyUrl';
import { certificatePdfFileName, fetchCertificatePdfFile } from './certificatePdfFile';

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

export function withPdfViewerChromeHidden(url: string): string {
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  return `${base}#toolbar=0&navpanes=0`;
}

export function printCertificateUrl(url: string): void {
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) return;
  const tryPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore */
    }
  };
  win.addEventListener('load', tryPrint);
  window.setTimeout(tryPrint, 1200);
}

export async function shareCertificatePdfFile(file: File, title: string): Promise<void> {
  if (typeof navigator.share !== 'function') {
    throw new Error('Share not supported on this phone. Use an installed share app from Chrome.');
  }
  const payload: ShareData = { files: [file], title, text: title };
  if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
    throw new Error('This phone cannot share PDF files. Update Chrome and retry.');
  }
  await navigator.share(payload);
}

async function tryShareCertificateFile(url: string, fileName: string): Promise<boolean> {
  try {
    const file = await fetchCertificatePdfFile(url, fileName);
    await shareCertificatePdfFile(file, fileName.replace(/\.pdf$/i, ''));
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return false;
  }
}

export async function shareVerificationCertificate(
  record: {
    customerName?: string;
    certificateNumber?: string;
    applicationNumber?: string;
    serialNumber?: string;
    emaapCertificatePdfUrl?: string;
  },
  fileUrl?: string | null,
): Promise<void> {
  const title = record.certificateNumber?.trim() || 'Certificate of Verification';
  const text = buildVerificationWhatsAppShareMessage(record);
  const url = buildCertificateVerifyUrl(record) || fileUrl?.trim() || '';
  const fetchUrl = fileUrl?.trim() || url;

  try {
    if (fetchUrl && (await tryShareCertificateFile(fetchUrl, certificatePdfFileName(record)))) {
      return;
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({
        title,
        text,
        ...(url ? { url } : {}),
      });
      return;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
  }

  window.open(buildWhatsAppShareUrl(text), '_blank', 'noopener,noreferrer');
}
