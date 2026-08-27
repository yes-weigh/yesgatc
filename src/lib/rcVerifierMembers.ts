import {
  collection,
  doc,
  getDoc,
  getDocs,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { FirestoreUserDoc } from '../types';

export type RcVerifierMemberDoc = {
  uid: string;
  aadhar: string;
  username: string;
  active?: boolean;
  createdAt: string;
};

export function rcVerifierMemberRef(rcId: string, verifierUid: string): DocumentReference {
  return doc(db, 'rcVerifiers', rcId, 'members', verifierUid);
}

export function rcVerifierMembersRef(rcId: string): CollectionReference {
  return collection(db, 'rcVerifiers', rcId, 'members');
}

export function buildRcVerifierMemberDoc(
  profile: FirestoreUserDoc,
  uid: string,
): RcVerifierMemberDoc {
  return {
    uid,
    aadhar: profile.aadhar,
    username: profile.username || '',
    active: profile.active !== false,
    createdAt: profile.createdAt,
  };
}

export async function fetchRcVerifierUsers(
  rcId: string,
): Promise<Array<FirestoreUserDoc & { uid: string }>> {
  const snap = await getDocs(rcVerifierMembersRef(rcId));
  const records: Array<FirestoreUserDoc & { uid: string }> = [];

  for (const member of snap.docs) {
    const userSnap = await getDoc(doc(db, 'users', member.id));
    if (!userSnap.exists()) continue;
    const data = userSnap.data() as FirestoreUserDoc;
    if (data.role !== 'verifier') continue;
    records.push({ uid: userSnap.id, ...data });
  }

  return records;
}
