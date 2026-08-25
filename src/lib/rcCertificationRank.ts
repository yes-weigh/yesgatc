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

export type RcCertifiedTypeCounts = {
  ov: number;
  rv: number;
  total: number;
};

export function certifiedTypeCountsByRcId(
  records: SiteCalibration[],
  rcIds: string[] = [],
): Map<string, RcCertifiedTypeCounts> {
  const counts = new Map<string, RcCertifiedTypeCounts>();
  for (const id of rcIds) {
    if (id) counts.set(id, { ov: 0, rv: 0, total: 0 });
  }
  for (const record of records) {
    if (getVerificationDisplayStatus(record) !== 'certified') continue;
    const id = record.rcId?.trim();
    if (!id) continue;
    const row = counts.get(id) ?? { ov: 0, rv: 0, total: 0 };
    if (record.verificationType === 'RV') row.rv += 1;
    else row.ov += 1;
    row.total += 1;
    counts.set(id, row);
  }
  return counts;
}

export function rankRcsByCertifiedCount(
  records: SiteCalibration[],
  rcIds: string[] = [],
): RcCertifiedRank[] {
  return [...certifiedTypeCountsByRcId(records, rcIds).entries()]
    .map(([rcId, row]) => ({ rcId, certified: row.total }))
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
