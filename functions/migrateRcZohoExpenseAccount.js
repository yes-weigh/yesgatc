const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

function normalizeZohoNumericId(value) {
  return String(value ?? '').replace(/\D/g, '');
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

function buildMigrationPatch(data) {
  const legacyId = String(data?.zohoVendorId || '').trim();
  const legacyName = String(data?.zohoVendorName || '').trim();
  if (!legacyId && !legacyName) return null;

  const patch = {
    zohoVendorId: FieldValue.delete(),
    zohoVendorName: FieldValue.delete(),
    updatedAt: new Date().toISOString(),
  };

  if (!String(data?.zohoExpenseAccountId || '').trim() && legacyId) {
    patch.zohoExpenseAccountId = normalizeZohoNumericId(legacyId);
  }
  if (!String(data?.zohoExpenseAccountName || '').trim() && legacyName) {
    patch.zohoExpenseAccountName = legacyName;
  }

  return patch;
}

/**
 * One-time / repeatable migration: zohoVendorId → zohoExpenseAccountId on RC profiles.
 */
async function migrateRcZohoExpenseAccountFieldsHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  await assertSuperAdmin(db, request.auth.uid);

  const snap = await db.collection('users').where('role', '==', 'rc_admin').get();
  let migrated = 0;
  let skipped = 0;

  const batchSize = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const docSnap of snap.docs) {
    const patch = buildMigrationPatch(docSnap.data());
    if (!patch) {
      skipped += 1;
      continue;
    }
    batch.set(docSnap.ref, patch, { merge: true });
    batchCount += 1;
    migrated += 1;

    if (batchCount >= batchSize) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  return { migrated, skipped, total: snap.size };
}

module.exports = {
  migrateRcZohoExpenseAccountFieldsHandler,
  buildMigrationPatch,
};
