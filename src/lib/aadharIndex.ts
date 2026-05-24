import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export type AadharIndexEntry = {
  uid: string;
  role: string;
  createdAt: string;
};

function normalizeAadharId(aadhar: string): string {
  return aadhar.replace(/\D/g, '').slice(0, 12);
}

export function aadharIndexDocId(aadhar: string): string {
  return normalizeAadharId(aadhar);
}

export function aadharIndexRef(aadhar: string) {
  return doc(db, 'aadharIndex', aadharIndexDocId(aadhar));
}

export function buildAadharIndexEntry(uid: string, role: string): AadharIndexEntry {
  return {
    uid,
    role,
    createdAt: new Date().toISOString(),
  };
}

export async function assertAadharIndexAvailable(aadhar: string, excludeUid?: string): Promise<void> {
  const normalized = aadharIndexDocId(aadhar);
  try {
    const snap = await getDoc(aadharIndexRef(normalized));
    if (!snap.exists()) return;
    const ownerUid = (snap.data() as AadharIndexEntry).uid;
    if (ownerUid && ownerUid !== excludeUid) {
      throw new Error('This Aadhar number is already registered.');
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already registered')) {
      throw err;
    }
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: string }).code)
        : '';
    if (code === 'permission-denied') {
      throw new Error(
        'Could not verify Aadhar availability. Deploy Firestore rules: firebase deploy --only firestore:rules',
      );
    }
    throw err;
  }
}

export async function reserveAadharIndex(aadhar: string, uid: string, role: string): Promise<void> {
  await setDoc(aadharIndexRef(aadhar), buildAadharIndexEntry(uid, role));
}

export async function releaseAadharIndex(aadhar: string): Promise<void> {
  const normalized = aadharIndexDocId(aadhar);
  if (normalized.length !== 12) return;
  await deleteDoc(aadharIndexRef(normalized)).catch(() => undefined);
}
