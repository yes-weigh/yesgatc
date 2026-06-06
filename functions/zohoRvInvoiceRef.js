const { HttpsError } = require('firebase-functions/v2/https');
const { zohoBooksRequest, normalizeZohoRvSettings } = require('./zohoRv');
const { zohoInvoiceOrderReferenceFromCertificate } = require('./zohoInvoiceReference');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';

async function loadZohoInvoiceRefSettings(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  return normalizeZohoRvSettings(snap.exists ? snap.data() : undefined);
}

function normalizeReference(value) {
  return String(value ?? '').trim();
}

function expectedInvoiceOrderReference(record) {
  return zohoInvoiceOrderReferenceFromCertificate(record.certificateNumber);
}

function canSyncRvInvoiceReference(record) {
  if (!record || record.verificationType !== 'RV') return false;
  if (record.resubmittedFromId) return false;
  if (!String(record.zohoInvoiceId || '').trim()) return false;

  const expected = expectedInvoiceOrderReference(record);
  if (!expected) return false;

  if (
    record.zohoInvoiceReferenceSynced === true
    && normalizeReference(record.zohoInvoiceReferenceNumber) === expected
  ) {
    return false;
  }

  return true;
}

function shouldSyncRvInvoiceReferenceOnWrite(before, after) {
  if (!after || after.verificationType !== 'RV') return false;
  if (after.resubmittedFromId) return false;
  if (!String(after.zohoInvoiceId || '').trim()) return false;

  const afterExpected = expectedInvoiceOrderReference(after);
  if (!afterExpected) return false;

  const beforeExpected = before ? expectedInvoiceOrderReference(before) : null;
  if (beforeExpected === afterExpected && after.zohoInvoiceReferenceSynced === true) {
    return normalizeReference(after.zohoInvoiceReferenceNumber) !== afterExpected;
  }

  return canSyncRvInvoiceReference(after);
}

async function writeInvoiceReferenceSyncResult(db, recordId, patch) {
  await db.doc(`siteCalibrations/${recordId}`).set(
    {
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

/**
 * Sets Zoho invoice ORDER NUMBER (reference_number) from certificate tail (e.g. 26/1271).
 */
async function processRvInvoiceReferenceSync(db, recordId, record, { allowLegacyPush = false } = {}) {
  const settings = await loadZohoInvoiceRefSettings(db);
  if (!settings.zohoRvInvoicingEnabled && !allowLegacyPush) {
    console.log(`Zoho RV invoicing disabled — skip invoice ref sync ${recordId}`);
    return null;
  }

  if (!canSyncRvInvoiceReference(record)) {
    if (allowLegacyPush) {
      throw new HttpsError('failed-precondition', 'This verification is not eligible for invoice reference sync.');
    }
    return null;
  }

  const orderReference = expectedInvoiceOrderReference(record);
  const invoiceId = String(record.zohoInvoiceId).trim();
  const syncedAt = new Date().toISOString();

  try {
    const current = await zohoBooksRequest(
      `/invoices/${invoiceId}?organization_id=${settings.zohoOrganizationId}`,
      { logLabel: 'invoice-ref-get' },
    );
    const invoice = current.invoice;
    if (!invoice?.invoice_id) {
      throw new Error('Zoho invoice lookup failed.');
    }

    const existingRef = normalizeReference(invoice.reference_number);
    if (existingRef === orderReference) {
      await writeInvoiceReferenceSyncResult(db, recordId, {
        zohoInvoiceReferenceNumber: orderReference,
        zohoInvoiceReferenceSynced: true,
        zohoInvoiceReferenceSyncedAt: syncedAt,
        zohoInvoiceReferenceSyncError: null,
      });
      return {
        recordId,
        zohoInvoiceId: invoiceId,
        zohoInvoiceReferenceNumber: orderReference,
        skipped: true,
        reason: 'already_set',
      };
    }

    const updated = await zohoBooksRequest(
      `/invoices/${invoiceId}?organization_id=${settings.zohoOrganizationId}`,
      {
        method: 'PUT',
        body: { reference_number: orderReference },
        logLabel: 'invoice-ref-update',
      },
    );

    const verifiedRef = normalizeReference(updated.invoice?.reference_number) || orderReference;
    await writeInvoiceReferenceSyncResult(db, recordId, {
      zohoInvoiceReferenceNumber: verifiedRef,
      zohoInvoiceReferenceSynced: true,
      zohoInvoiceReferenceSyncedAt: syncedAt,
      zohoInvoiceReferenceSyncError: null,
    });

    console.log(
      `Zoho invoice reference synced for ${recordId}: ${invoice.invoice_number || invoiceId} → ${verifiedRef}`,
    );

    return {
      recordId,
      zohoInvoiceId: invoiceId,
      zohoInvoiceNumber: invoice.invoice_number ? String(invoice.invoice_number) : undefined,
      zohoInvoiceReferenceNumber: verifiedRef,
      synced: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Zoho invoice reference sync failed.';
    console.error(`Zoho invoice reference sync failed for ${recordId}`, err);
    await writeInvoiceReferenceSyncResult(db, recordId, {
      zohoInvoiceReferenceSyncError: message.slice(0, 500),
      zohoInvoiceReferenceSyncedAt: syncedAt,
    });
    if (allowLegacyPush) {
      throw new HttpsError('internal', message);
    }
    return null;
  }
}

async function onSiteCalibrationZohoInvoiceRefHandler(event, db) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!shouldSyncRvInvoiceReferenceOnWrite(before, after)) return;

  const recordId = event.params.recordId;
  await processRvInvoiceReferenceSync(db, recordId, after);
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function pushLegacyRvInvoiceReferenceHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  await assertSuperAdmin(db, request.auth.uid);

  const recordId = request.data?.recordId;
  if (!recordId || typeof recordId !== 'string') {
    throw new HttpsError('invalid-argument', 'recordId is required.');
  }

  const snap = await db.doc(`siteCalibrations/${recordId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Verification record not found.');
  }

  const record = snap.data();
  if (!expectedInvoiceOrderReference(record)) {
    throw new HttpsError(
      'failed-precondition',
      'Certificate number is required to derive the Zoho order reference (e.g. 26/1271).',
    );
  }

  const result = await processRvInvoiceReferenceSync(db, recordId, record, {
    allowLegacyPush: true,
  });
  if (!result) {
    throw new HttpsError('internal', 'Invoice reference sync did not complete.');
  }
  return result;
}

module.exports = {
  processRvInvoiceReferenceSync,
  canSyncRvInvoiceReference,
  shouldSyncRvInvoiceReferenceOnWrite,
  onSiteCalibrationZohoInvoiceRefHandler,
  pushLegacyRvInvoiceReferenceHandler,
  expectedInvoiceOrderReference,
};
