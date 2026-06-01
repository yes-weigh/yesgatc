import type { SiteCalibration } from '../types';

type SortableVerification = Pick<SiteCalibration, 'certificateNumber' | 'createdAt'>;

function certificateSortTuple(certificateNumber?: string): [hasCert: number, tailNum: number, full: string] {
  const full = certificateNumber?.trim() ?? '';
  if (!full) return [0, 0, ''];

  const tail = full.split('/').pop() ?? '';
  const tailNum = /^\d+$/.test(tail) ? parseInt(tail, 10) : Number.NaN;

  return [1, Number.isNaN(tailNum) ? 0 : tailNum, full.toLowerCase()];
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
