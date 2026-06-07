import { deleteField, doc, updateDoc, type Firestore } from 'firebase/firestore';
import type { FirestoreUserDoc } from '../types';

function normalizeZohoExpenseAccountId(value: string): string {
  return value.replace(/\D/g, '');
}

type RcZohoExpenseAccountDoc = Pick<
  FirestoreUserDoc,
  'zohoExpenseAccountId' | 'zohoExpenseAccountName' | 'zohoVendorId' | 'zohoVendorName'
>;

export function rcZohoExpenseAccountIdFromDoc(doc: RcZohoExpenseAccountDoc): string {
  return doc.zohoExpenseAccountId?.trim() || doc.zohoVendorId?.trim() || '';
}

export function rcZohoExpenseAccountNameFromDoc(doc: RcZohoExpenseAccountDoc): string {
  return doc.zohoExpenseAccountName?.trim() || doc.zohoVendorName?.trim() || '';
}

export function rcNeedsZohoExpenseAccountMigration(doc: RcZohoExpenseAccountDoc): boolean {
  return Boolean(doc.zohoVendorId?.trim() || doc.zohoVendorName?.trim());
}

export function rcZohoExpenseAccountLegacyCleanupFields(): {
  zohoVendorId: ReturnType<typeof deleteField>;
  zohoVendorName: ReturnType<typeof deleteField>;
} {
  return {
    zohoVendorId: deleteField(),
    zohoVendorName: deleteField(),
  };
}

export function buildRcZohoExpenseAccountMigrationPatch(
  doc: RcZohoExpenseAccountDoc,
): Record<string, unknown> | null {
  if (!rcNeedsZohoExpenseAccountMigration(doc)) return null;

  const patch: Record<string, unknown> = {
    zohoVendorId: deleteField(),
    zohoVendorName: deleteField(),
  };

  if (!doc.zohoExpenseAccountId?.trim() && doc.zohoVendorId?.trim()) {
    patch.zohoExpenseAccountId = normalizeZohoExpenseAccountId(doc.zohoVendorId);
  }
  if (!doc.zohoExpenseAccountName?.trim() && doc.zohoVendorName?.trim()) {
    patch.zohoExpenseAccountName = doc.zohoVendorName.trim();
  }

  return patch;
}

/** Copy legacy vendor fields to expense account fields and remove old keys. Idempotent. */
export async function migrateRcZohoExpenseAccountFieldsForUsers(
  users: Array<{ uid: string } & FirestoreUserDoc>,
  firestore: Firestore,
): Promise<number> {
  const targets = users
    .map(user => ({ user, patch: buildRcZohoExpenseAccountMigrationPatch(user) }))
    .filter((entry): entry is { user: { uid: string } & FirestoreUserDoc; patch: Record<string, unknown> } => (
      entry.patch != null
    ));

  if (targets.length === 0) return 0;

  await Promise.all(
    targets.map(({ user, patch }) => updateDoc(doc(firestore, 'users', user.uid), patch)),
  );

  return targets.length;
}
