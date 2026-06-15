/** Full DOCA certificate prefix before the running sequence (e.g. …/26/1365). */
export const CERTIFICATE_SEQUENCE_PREFIX = 'IND/GATC/KL/26/04/26/';

export const DEFAULT_CERTIFICATE_SEQUENCE_MAX = 1366;

/** Trailing numeric segment (IND/GATC/KL/26/04/26/1365 → 1365). */
export function parseCertificateSequenceNumber(value?: string | null): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const tail = trimmed.split('/').pop() ?? '';
  if (!/^\d+$/.test(tail)) return null;

  const sequence = parseInt(tail, 10);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
}

export function formatCertificateNumberFromSequence(sequence: number): string {
  return `${CERTIFICATE_SEQUENCE_PREFIX}${sequence}`;
}

export type CertificateSequenceHit = {
  sequence: number;
  certificateNumber: string;
  source: 'scrape' | 'verification';
};

export type CertificateGapReport = {
  maxSequence: number;
  presentCount: number;
  missingCount: number;
  highestPresent: number | null;
  present: CertificateSequenceHit[];
  missing: { sequence: number; certificateNumber: string }[];
};

export function buildCertificateGapReport(
  scrapeRecords: Array<{
    generateCertificate: string;
    gatcCertificateNo: string;
    pdfExtract?: { certificateNumber?: string } | null;
  }>,
  verificationCertificateNumbers: ReadonlySet<string>,
  maxSequence: number = DEFAULT_CERTIFICATE_SEQUENCE_MAX,
): CertificateGapReport {
  const presentBySequence = new Map<number, CertificateSequenceHit>();

  const addHit = (raw: string | undefined, source: CertificateSequenceHit['source']) => {
    const sequence = parseCertificateSequenceNumber(raw);
    if (sequence == null || sequence < 1 || sequence > maxSequence) return;

    const certificateNumber = raw?.trim() || formatCertificateNumberFromSequence(sequence);
    const existing = presentBySequence.get(sequence);
    if (!existing) {
      presentBySequence.set(sequence, { sequence, certificateNumber, source });
      return;
    }

    if (existing.source === 'verification' || source === existing.source) return;
    presentBySequence.set(sequence, {
      sequence,
      certificateNumber: existing.certificateNumber || certificateNumber,
      source: 'scrape',
    });
  };

  for (const record of scrapeRecords) {
    addHit(record.generateCertificate, 'scrape');
    addHit(record.gatcCertificateNo, 'scrape');
    addHit(record.pdfExtract?.certificateNumber, 'scrape');
  }

  for (const certificateNumber of verificationCertificateNumbers) {
    addHit(certificateNumber, 'verification');
  }

  const present = [...presentBySequence.values()].sort((a, b) => a.sequence - b.sequence);
  const presentSet = new Set(present.map(hit => hit.sequence));
  const missing: CertificateGapReport['missing'] = [];

  for (let sequence = 1; sequence <= maxSequence; sequence += 1) {
    if (!presentSet.has(sequence)) {
      missing.push({
        sequence,
        certificateNumber: formatCertificateNumberFromSequence(sequence),
      });
    }
  }

  return {
    maxSequence,
    presentCount: present.length,
    missingCount: missing.length,
    highestPresent: present.length > 0 ? present[present.length - 1]!.sequence : null,
    present,
    missing,
  };
}
