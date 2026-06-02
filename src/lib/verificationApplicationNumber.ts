import { doc, runTransaction, type Firestore } from 'firebase/firestore';

export const VERIFICATION_APPLICATION_NUMBER_PREFIX = 'VC';

const APPLICATION_NUMBER_PATTERN = /^VC\/(\d{2})\/(\d+)$/;

/** Internal reference — `VC/26/1`, `VC/26/2`, … (yy = calendar year % 100). */
export function formatVerificationApplicationNumber(calendarYear: number, sequence: number): string {
  const yy = calendarYear % 100;
  return `${VERIFICATION_APPLICATION_NUMBER_PREFIX}/${yy}/${sequence}`;
}

export function verificationApplicationNumberCounterDocId(calendarYear: number): string {
  const yy = calendarYear % 100;
  return `verificationApplicationNumber_${yy}`;
}

export function parseVerificationApplicationNumber(
  value: string | undefined | null,
): { calendarYear: number; sequence: number } | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;

  const match = APPLICATION_NUMBER_PATTERN.exec(trimmed);
  if (!match) return null;

  const yy = Number(match[1]);
  const sequence = Number(match[2]);
  if (!Number.isFinite(sequence) || sequence < 1) return null;

  return { calendarYear: 2000 + yy, sequence };
}

/**
 * Atomically reserves one or more application numbers for the given calendar year.
 * Safe when multiple verifications are saved at the same time.
 */
export async function allocateVerificationApplicationNumbers(
  firestore: Firestore,
  count: number,
  calendarYear: number = new Date().getFullYear(),
): Promise<string[]> {
  if (count <= 0) return [];

  const counterRef = doc(
    firestore,
    '_counters',
    verificationApplicationNumberCounterDocId(calendarYear),
  );

  return runTransaction(firestore, async tx => {
    const snap = await tx.get(counterRef);
    const startSeq = snap.exists()
      ? Math.max(1, Number(snap.data()?.nextSeq) || 1)
      : 1;

    const numbers = Array.from({ length: count }, (_, index) =>
      formatVerificationApplicationNumber(calendarYear, startSeq + index),
    );

    tx.set(counterRef, { nextSeq: startSeq + count, year: calendarYear }, { merge: true });
    return numbers;
  });
}

export async function allocateVerificationApplicationNumber(
  firestore: Firestore,
  calendarYear?: number,
): Promise<string> {
  const year = calendarYear ?? new Date().getFullYear();
  const [number] = await allocateVerificationApplicationNumbers(firestore, 1, year);
  return number;
}
