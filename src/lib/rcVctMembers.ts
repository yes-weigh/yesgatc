import {
  collection,
  doc,
  getDoc,
  getDocs,
  type DocumentReference,
  type CollectionReference,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { FirestoreUserDoc } from '../types';

export type RcVctMemberDoc = {
  uid: string;
  aadhar: string;
  username: string;
  approvalStatus?: string;
  active?: boolean;
  createdAt: string;
};

export function rcVctMemberRef(rcId: string, vctUid: string): DocumentReference {
  return doc(db, 'rcVcts', rcId, 'members', vctUid);
}

export function rcVctMembersRef(rcId: string): CollectionReference {
  return collection(db, 'rcVcts', rcId, 'members');
}

export function buildRcVctMemberDoc(profile: FirestoreUserDoc, uid: string): RcVctMemberDoc {
  return {
    uid,
    aadhar: profile.aadhar,
    username: profile.username || '',
    approvalStatus: profile.approvalStatus ?? 'pending',
    active: profile.active !== false,
    createdAt: profile.createdAt,
  };
}

export async function fetchRcVctUsers(
  rcId: string,
): Promise<Array<FirestoreUserDoc & { uid: string }>> {
  const snap = await getDocs(rcVctMembersRef(rcId));
  const records: Array<FirestoreUserDoc & { uid: string }> = [];

  for (const member of snap.docs) {
    const userSnap = await getDoc(doc(db, 'users', member.id));
    if (!userSnap.exists()) continue;
    records.push({ uid: userSnap.id, ...(userSnap.data() as FirestoreUserDoc) });
  }

  return records;
}
