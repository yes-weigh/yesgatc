import { formatVerificationInstrumentFields } from './productCalculations';
import { verificationValidUptoDate } from './verificationLabel';
import { downloadCertificatePdfFile } from './certificatePdfFile';

export type PublicCertificatePhoto = {
  kind: string;
  label: string;
  url: string;
};

export type PublicCertificateHit = {
  certificateNumber: string | null;
  serialNumber: string | null;
  customerName: string | null;
  certifiedAt: string | null;
  verificationType: 'OV' | 'RV' | null;
  voided: boolean;
  pdfUrl: string | null;
  machinePhotoUrl?: string | null;
  photos?: PublicCertificatePhoto[];
  maximumCapacity?: number | null;
  verificationScaleInterval?: number | null;
  unitOfMeasurement?: 'kg' | 'g' | null;
  accuracyClass?: string | null;
};

export type PublicCertificateLookupResult = {
  query: string;
  certificates: PublicCertificateHit[];
};

const LOOKUP_PATH = '/api/lookupPublicCertificates';
const LOOKUP_FALLBACK = 'https://us-central1-yesgatc.cloudfunctions.net/lookupPublicCertificates';

export function mapPublicCertificateLookupError(err: unknown): string {
  return err instanceof Error ? err.message : 'Lookup failed.';
}

async function postLookup(url: string, query: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

async function readLookupPayload(response: Response): Promise<PublicCertificateLookupResult & { error?: string }> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('not-json');
  }
  return response.json() as Promise<PublicCertificateLookupResult & { error?: string }>;
}

export async function lookupPublicCertificates(query: string): Promise<PublicCertificateHit[]> {
  const urls = [LOOKUP_PATH, LOOKUP_FALLBACK];
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await postLookup(url, query);
      const payload = await readLookupPayload(response);
      if (!response.ok) {
        lastError = new Error(payload.error?.trim() || 'Lookup failed.');
        if (response.status >= 500) continue;
        throw lastError;
      }
      return payload.certificates ?? [];
    } catch (err) {
      if (err instanceof Error && err.message !== 'not-json') lastError = err;
    }
  }

  throw lastError ?? new Error('Lookup service unavailable. Try again.');
}

export function publicCertificatePhotos(hit: PublicCertificateHit): PublicCertificatePhoto[] {
  if (hit.photos?.length) {
    return hit.photos.filter(photo => photo.url?.trim());
  }
  const fallback = hit.machinePhotoUrl?.trim();
  return fallback ? [{ kind: 'stamping', label: 'Serial plate', url: fallback }] : [];
}

export function formatPublicCertificateSpecs(hit: PublicCertificateHit): {
  max: string;
  min: string;
  e: string;
  accuracyClass: string;
} {
  const fields = formatVerificationInstrumentFields({
    maximumCapacity: hit.maximumCapacity ?? undefined,
    unitOfMeasurement: hit.unitOfMeasurement ?? undefined,
    verificationScaleInterval: hit.verificationScaleInterval ?? undefined,
  });
  return {
    ...fields,
    accuracyClass: hit.accuracyClass?.trim() || '—',
  };
}

export function formatPublicCertificateNextDue(certifiedAt: string | null): string {
  const date = verificationValidUptoDate(certifiedAt ?? undefined);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function publicCertificateFileName(hit: PublicCertificateHit): string {
  const raw = hit.certificateNumber || hit.serialNumber || 'certificate';
  return `${raw.replace(/[^\w.-]+/g, '-')}.pdf`;
}

export async function downloadPublicCertificatePdf(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download failed.');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Native phone share sheet with the PDF file. No WhatsApp / URL share. */
export async function sharePublicCertificatePdf(file: File, title: string): Promise<void> {
  const name = file.name.toLowerCase().endsWith('.pdf') ? file.name : `${file.name}.pdf`;
  const pdf = new File([file], name, { type: 'application/pdf' });
  const files = [pdf];
  const canShareFiles =
    typeof navigator.share === 'function'
    && (typeof navigator.canShare !== 'function' || navigator.canShare({ files }));

  if (canShareFiles) {
    await navigator.share({ files, title });
    return;
  }

  downloadCertificatePdfFile(pdf);
}
