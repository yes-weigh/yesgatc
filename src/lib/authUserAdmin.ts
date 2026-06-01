import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

/** Matches deployed Cloud Functions region (deleteAuthUser is live here). */
const FUNCTIONS_REGION = 'us-central1';

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

type DeleteAuthUserResult = {
  deleted: boolean;
  reason?: string;
};

type CleanupGhostAuthResult = {
  dryRun: boolean;
  count: number;
  users: Array<{ uid: string; email: string }>;
};

/** Removes a Firebase Auth account via Cloud Function (Admin SDK). */
export async function deleteAuthUserAccount(uid: string): Promise<DeleteAuthUserResult> {
  const fn = httpsCallable<{ uid: string }, DeleteAuthUserResult>(
    functionsClient(),
    'deleteAuthUser',
  );
  const result = await fn({ uid });
  return result.data;
}

/** Super Admin: list or remove Auth accounts with no Firestore profile. */
export async function cleanupGhostAuthUsers(dryRun = true): Promise<CleanupGhostAuthResult> {
  const fn = httpsCallable<{ dryRun: boolean }, CleanupGhostAuthResult>(
    functionsClient(),
    'cleanupGhostAuthUsers',
  );
  const result = await fn({ dryRun });
  return result.data;
}

/** Best-effort rollback when registration fails after Auth user creation. */
export async function rollbackCreatedAuthUser(uid: string | undefined): Promise<void> {
  if (!uid) return;
  try {
    await deleteAuthUserAccount(uid);
  } catch {
    // Orphan may remain; Super Admin can run cleanup script.
  }
}
