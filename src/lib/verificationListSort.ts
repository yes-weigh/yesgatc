import type { SiteCalibration } from '../types';
import { parseCertificateSequenceNumber } from './certificateSequence';

type SortableVerification = Pick<SiteCalibration, 'certificateNumber' | 'createdAt'>;

function certificateTailNumber(certificateNumber?: string): number | null {
  return parseCertificateSequenceNumber(certificateNumber);
}

function certificateSortTuple(certificateNumber?: string): [hasCert: number, tailNum: number, full: string] {
  const full = certificateNumber?.trim() ?? '';
  if (!full) return [0, 0, ''];

  const tailNum = certificateTailNumber(full) ?? 0;

  return [1, tailNum, full.toLowerCase()];
}

/** Highest trailing certificate sequence (e.g. IND/GATC/KL/26/04/26/1365 → 1365). */
export function maxCertificateSequenceNumber(
  records: Pick<SiteCalibration, 'certificateNumber'>[],
): number | null {
  let max: number | null = null;
  for (const record of records) {
    const tail = certificateTailNumber(record.certificateNumber);
    if (tail == null) continue;
    if (max == null || tail > max) max = tail;
  }
  return max;
}

/** Highest certificate number first; records without a certificate number last. */
export function compareVerificationsByCertificateDesc(
  a: SortableVerification,
  b: SortableVerification,
): number {
  const keyA = certificateSortTuple(a.certificateNumber);
  const keyB = certificateSortTuple(b.certificateNumber);

  if (keyA[0] !== keyB[0]) return keyB[0] - keyA[0];
  if (keyA[1] !== keyB[1]) return keyB[1] - keyA[1];

  const fullCmp = keyB[2].localeCompare(keyA[2]);
  if (fullCmp !== 0) return fullCmp;

  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

export function sortVerificationsByCertificateDesc<T extends SortableVerification>(records: T[]): T[] {
  return [...records].sort(compareVerificationsByCertificateDesc);
}
