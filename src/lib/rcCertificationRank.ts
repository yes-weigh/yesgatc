import { doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
import { APP_SETTINGS_COLLECTION } from './appSettings';
import { getVerificationDisplayStatus } from './verificationRequest';
import type { SiteCalibration } from '../types';

export const RC_CERTIFICATION_RANKS_DOC = 'rcCertificationRanks';

export type RcCertifiedRank = {
  rcId: string;
  certified: number;
};

export function rankRcsByCertifiedCount(
  records: SiteCalibration[],
  rcIds: string[] = [],
): RcCertifiedRank[] {
  const counts = new Map<string, number>();
  for (const id of rcIds) {
    if (id) counts.set(id, 0);
  }
  for (const record of records) {
    if (getVerificationDisplayStatus(record) !== 'certified') continue;
    const id = record.rcId?.trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([rcId, certified]) => ({ rcId, certified }))
    .sort((a, b) => b.certified - a.certified || a.rcId.localeCompare(b.rcId));
}

export function rankOfRc(ranks: RcCertifiedRank[], rcId: string): number | null {
  const index = ranks.findIndex(row => row.rcId === rcId);
  return index >= 0 ? index + 1 : null;
}

export async function saveRcCertificationRanks(ranks: RcCertifiedRank[]): Promise<void> {
  await setDoc(
    doc(db, APP_SETTINGS_COLLECTION, RC_CERTIFICATION_RANKS_DOC),
    { ranks, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export function parseRcCertificationRanks(value: unknown): RcCertifiedRank[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return [];
    const data = row as { rcId?: unknown; certified?: unknown };
    const rcId = typeof data.rcId === 'string' ? data.rcId : '';
    const certified =
      typeof data.certified === 'number' && Number.isFinite(data.certified) ? data.certified : NaN;
    if (!rcId || !Number.isFinite(certified)) return [];
    return [{ rcId, certified }];
  });
}

export async function fetchRcCertificationRanks(): Promise<RcCertifiedRank[]> {
  const snap = await getDoc(doc(db, APP_SETTINGS_COLLECTION, RC_CERTIFICATION_RANKS_DOC));
  return parseRcCertificationRanks(snap.data()?.ranks);
}

export function subscribeRcCertificationRanks(
  onData: (ranks: RcCertifiedRank[]) => void,
): Unsubscribe {
  return onSnapshot(doc(db, APP_SETTINGS_COLLECTION, RC_CERTIFICATION_RANKS_DOC), snapshot => {
    onData(parseRcCertificationRanks(snapshot.data()?.ranks));
  });
}
