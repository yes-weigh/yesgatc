import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { SiteCalibration } from '../types';

export function verificationRecordsQuery(
  db: Firestore,
  rcUid: string,
  scope: { isVct: boolean; actorUid: string | null },
): Query {
  const base = collection(db, 'siteCalibrations');
  if (scope.isVct && scope.actorUid) {
    return query(
      base,
      where('rcId', '==', rcUid),
      where('createdByUid', '==', scope.actorUid),
    );
  }
  return query(base, where('rcId', '==', rcUid));
}

export function verificationRecordOwnedByVct(
  record: { createdByUid?: string; vctId?: string },
  vctUid: string,
): boolean {
  return record.createdByUid === vctUid || record.vctId === vctUid;
}

export async function fetchAllSiteCalibrations(): Promise<SiteCalibration[]> {
  const snapshot = await getDocs(collection(db, 'siteCalibrations'));
  return snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<SiteCalibration, 'id'>),
  }));
}
