import { FirebaseError } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const FUNCTIONS_REGION = 'us-central1';

export type PublicCertificateHit = {
  certificateNumber: string | null;
  serialNumber: string | null;
  customerName: string | null;
  certifiedAt: string | null;
  verificationType: 'OV' | 'RV' | null;
  voided: boolean;
  pdfUrl: string | null;
};

export type PublicCertificateLookupResult = {
  query: string;
  certificates: PublicCertificateHit[];
};

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

export function mapPublicCertificateLookupError(err: unknown): string {
  if (err instanceof FirebaseError) {
    if (err.code === 'functions/invalid-argument') {
      return err.message.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]+\)\s*$/, '').trim()
        || 'Enter a valid serial or certificate number.';
    }
    if (err.code === 'functions/unavailable' || err.code === 'functions/internal') {
      return 'Lookup service unavailable. Try again.';
    }
  }
  return err instanceof Error ? err.message : 'Lookup failed.';
}

export async function lookupPublicCertificates(query: string): Promise<PublicCertificateHit[]> {
  const fn = httpsCallable<{ query: string }, PublicCertificateLookupResult>(
    functionsClient(),
    'lookupPublicCertificates',
  );
  const result = await fn({ query });
  return result.data.certificates ?? [];
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
