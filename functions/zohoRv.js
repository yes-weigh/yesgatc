const { defineSecret } = require('firebase-functions/params');
const { HttpsError } = require('firebase-functions/v2/https');
const { zohoInvoiceOrderReferenceFromCertificate } = require('./zohoInvoiceReference');

const zohoClientId = defineSecret('ZOHO_CLIENT_ID');
const zohoClientSecret = defineSecret('ZOHO_CLIENT_SECRET');
const zohoRefreshToken = defineSecret('ZOHO_REFRESH_TOKEN');

const ZOHO_ACCOUNTS_BASE = 'https://accounts.zoho.in';
const ZOHO_BOOKS_BASE = 'https://www.zohoapis.in/books/v3';
const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';

const DEFAULT_ZOHO_RV_SETTINGS = {
  zohoRvInvoicingEnabled: true,
  zohoOrganizationId: '60001225303',
  zohoSalespersonId: '99381000030360028',
  zohoItemIdUpto20Kg: '99381000030360012',
  zohoItemIdAbove20Kg: '99381000030360017',
  zohoModeOfTransport: 'CUSTOMER PICKUP',
};

const ZOHO_MODE_OF_TRANSPORT_ALIASES = {
  'without machine': 'CUSTOMER PICKUP',
  'with machine': 'With Machine',
};

function resolveZohoModeOfTransport(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return DEFAULT_ZOHO_RV_SETTINGS.zohoModeOfTransport;
  const alias = ZOHO_MODE_OF_TRANSPORT_ALIASES[trimmed.toLowerCase()];
  return alias || trimmed;
}

function normalizeZohoNumericId(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeZohoRvSettings(data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    zohoRvInvoicingEnabled: source.zohoRvInvoicingEnabled !== false,
    zohoOrganizationId:
      normalizeZohoNumericId(source.zohoOrganizationId) || DEFAULT_ZOHO_RV_SETTINGS.zohoOrganizationId,
    zohoSalespersonId:
      normalizeZohoNumericId(source.zohoSalespersonId) || DEFAULT_ZOHO_RV_SETTINGS.zohoSalespersonId,
    zohoItemIdUpto20Kg:
      normalizeZohoNumericId(source.zohoItemIdUpto20Kg) || DEFAULT_ZOHO_RV_SETTINGS.zohoItemIdUpto20Kg,
    zohoItemIdAbove20Kg:
      normalizeZohoNumericId(source.zohoItemIdAbove20Kg) || DEFAULT_ZOHO_RV_SETTINGS.zohoItemIdAbove20Kg,
    zohoModeOfTransport: resolveZohoModeOfTransport(source.zohoModeOfTransport),
  };
}

function maximumCapacityKg(record) {
  const capacity = record.maximumCapacity;
  if (capacity == null || !Number.isFinite(Number(capacity))) return null;
  if (record.unitOfMeasurement === 'g') return Number(capacity) / 1000;
  return Number(capacity);
}

function pickZohoItemId(record, settings) {
  const capacityKg = maximumCapacityKg(record);
  if (capacityKg == null) {
    throw new Error('maximumCapacity is required to select a Zoho RV product.');
  }
  return capacityKg <= 20 ? settings.zohoItemIdUpto20Kg : settings.zohoItemIdAbove20Kg;
}

function formatZohoLineMaxCap(record) {
  const cap = record.maximumCapacity;
  if (cap == null || !Number.isFinite(Number(cap))) return null;
  const unit = record.unitOfMeasurement === 'g' ? 'g' : 'kg';
  return `${cap} ${unit}`;
}

function formatZohoLineAccuracy(record) {
  const interval = record.verificationScaleInterval;
  if (interval == null || !Number.isFinite(Number(interval))) return null;
  return `${interval} g`;
}

async function resolveProductAccuracyClass(db, record) {
  const productId = String(record.productId || '').trim();
  if (!productId) return null;
  const snap = await db.doc(`products/${productId}`).get();
  if (!snap.exists) return null;
  const accuracyClass = String(snap.data()?.accuracyClass || '').trim();
  return accuracyClass || null;
}

/** Instrument details only — never include RC end-customer PII (name, phone, address). */
async function buildLineDescription(db, record) {
  const parts = [];

  const serial = String(record.serialNumber || '').trim();
  if (serial) parts.push(`Serial ${serial}`);

  const productName = String(record.productName || '').trim();
  if (productName) parts.push(productName);

  const accuracyClass = await resolveProductAccuracyClass(db, record);
  if (accuracyClass) parts.push(`Class ${accuracyClass}`);

  const maxCap = formatZohoLineMaxCap(record);
  if (maxCap) parts.push(`Max cap ${maxCap}`);

  const accuracy = formatZohoLineAccuracy(record);
  if (accuracy) parts.push(`Accuracy ${accuracy}`);

  return parts.join(' · ') || undefined;
}

async function loadZohoRvSettings(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  return normalizeZohoRvSettings(snap.exists ? snap.data() : undefined);
}

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

async function getZohoAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const params = new URLSearchParams({
    refresh_token: zohoRefreshToken.value(),
    client_id: zohoClientId.value(),
    client_secret: zohoClientSecret.value(),
    grant_type: 'refresh_token',
  });

  const response = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token?${params.toString()}`, {
    method: 'POST',
  });
  const body = await response.json();

  if (!response.ok || !body.access_token) {
    const message = body.error || body.message || `Zoho token refresh failed (${response.status})`;
    throw new Error(message);
  }

  cachedAccessToken = body.access_token;
  cachedAccessTokenExpiresAt = now + Number(body.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

function summarizeZohoInvoice(invoice) {
  if (!invoice || typeof invoice !== 'object') return null;
  return {
    invoice_id: invoice.invoice_id,
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    customer_id: invoice.customer_id,
    customer_name: invoice.customer_name,
    date: invoice.date,
    total: invoice.total,
    balance: invoice.balance,
    cf_gatc_ref_no: (invoice.custom_fields || []).find(
      field => field.api_name === 'cf_gatc_ref_no',
    )?.value,
    cf_mode_of_transport: (invoice.custom_fields || []).find(
      field => field.api_name === 'cf_mode_of_transport',
    )?.value,
  };
}

async function zohoBooksRequest(path, { method = 'GET', body, logLabel } = {}) {
  const accessToken = await getZohoAccessToken();
  const response = await fetch(`${ZOHO_BOOKS_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (logLabel) {
    console.log(`Zoho API ${logLabel}`, {
      method,
      path,
      httpStatus: response.status,
      code: payload.code,
      message: payload.message,
      invoice: summarizeZohoInvoice(payload.invoice),
    });
  }
  if (!response.ok) {
    const message = payload.message || payload.error || `Zoho Books request failed (${response.status})`;
    throw new Error(message);
  }
  if (payload.code != null && Number(payload.code) !== 0) {
    throw new Error(payload.message || `Zoho Books error code ${payload.code}`);
  }
  return payload;
}

async function createRvInvoice(db, record, rcZohoId, settings) {
  const itemId = pickZohoItemId(record, settings);
  const applicationNumber = String(record.applicationNumber || '').trim();
  if (!applicationNumber) {
    throw new Error('applicationNumber is required for Zoho invoice.');
  }

  const orderReference = zohoInvoiceOrderReferenceFromCertificate(record.certificateNumber);

  const invoiceBody = {
    customer_id: rcZohoId,
    salesperson_id: settings.zohoSalespersonId,
    date: (record.submittedAt || new Date().toISOString()).slice(0, 10),
    line_items: [
      {
        item_id: itemId,
        quantity: 1,
        description: await buildLineDescription(db, record),
      },
    ],
    custom_fields: [
      { api_name: 'cf_gatc_ref_no', value: applicationNumber },
      { api_name: 'cf_mode_of_transport', value: settings.zohoModeOfTransport },
    ],
  };

  if (orderReference) {
    invoiceBody.reference_number = orderReference;
  }

  const created = await zohoBooksRequest(
    `/invoices?organization_id=${settings.zohoOrganizationId}`,
    { method: 'POST', body: invoiceBody, logLabel: 'create-invoice' },
  );

  const invoice = created.invoice;
  if (!invoice?.invoice_id) {
    throw new Error('Zoho invoice create response did not include invoice_id.');
  }

  await zohoBooksRequest(
    `/invoices/${invoice.invoice_id}/status/sent?organization_id=${settings.zohoOrganizationId}`,
    { method: 'POST', logLabel: 'mark-sent' },
  );

  const verified = await zohoBooksRequest(
    `/invoices/${invoice.invoice_id}?organization_id=${settings.zohoOrganizationId}`,
    { method: 'GET', logLabel: 'verify-invoice' },
  );
  const verifiedInvoice = verified.invoice;
  if (!verifiedInvoice?.invoice_id) {
    throw new Error('Zoho invoice verify GET did not return invoice_id.');
  }

  const summary = summarizeZohoInvoice(verifiedInvoice);
  console.log('Zoho invoice verified', {
    organizationId: settings.zohoOrganizationId,
    ...summary,
  });

  return {
    zohoInvoiceId: String(verifiedInvoice.invoice_id),
    zohoInvoiceNumber: verifiedInvoice.invoice_number
      ? String(verifiedInvoice.invoice_number)
      : undefined,
    zohoInvoiceStatus: verifiedInvoice.status ? String(verifiedInvoice.status) : undefined,
    zohoCustomerId: verifiedInvoice.customer_id ? String(verifiedInvoice.customer_id) : undefined,
    zohoCustomerName: verifiedInvoice.customer_name ? String(verifiedInvoice.customer_name) : undefined,
    zohoInvoiceTotal: verifiedInvoice.total != null ? Number(verifiedInvoice.total) : undefined,
    zohoOrganizationId: settings.zohoOrganizationId,
    ...(orderReference
      ? {
        zohoInvoiceReferenceNumber: orderReference,
        zohoInvoiceReferenceSynced: true,
        zohoInvoiceReferenceSyncedAt: new Date().toISOString(),
      }
      : {}),
    zohoApiSummary: summary,
  };
}

function shouldProcessRvZohoInvoice(before, after) {
  if (!after || after.verificationType !== 'RV') return false;
  if (after.resubmittedFromId) return false;
  if (after.zohoInvoiceId) return false;
  if (after.zohoPushStatus === 'sent') return false;

  const afterStatus = verificationRecordStatus(after);
  if (afterStatus === 'draft') return false;

  const beforeStatus = before ? verificationRecordStatus(before) : 'draft';
  if (beforeStatus !== 'draft') return false;

  return true;
}

async function writeZohoPushResult(db, recordId, patch) {
  await db.doc(`siteCalibrations/${recordId}`).set(
    {
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

function verificationRecordStatus(record) {
  const status = String(record?.status || '').trim();
  if (status === 'draft' || status === 'submitted' || status === 'approved' || status === 'certified') {
    return status;
  }
  if (record?.submittedAt?.trim()) return 'submitted';
  if (record?.approvedAt?.trim()) return 'approved';
  if (record?.certifiedAt?.trim()) return 'certified';
  return 'draft';
}

function canPushRvZohoInvoice(record) {
  if (!record || record.verificationType !== 'RV') return false;
  if (record.resubmittedFromId) return false;
  if (record.zohoInvoiceId) return false;
  if (record.zohoPushStatus === 'sent') return false;
  return verificationRecordStatus(record) !== 'draft';
}

/** Draft RV awaiting pre-submit Zoho invoice (submit gate). */
function canPushRvZohoInvoicePreSubmit(record) {
  if (!record || record.verificationType !== 'RV') return false;
  if (record.resubmittedFromId) return false;
  if (record.zohoInvoiceId) return false;
  if (record.zohoPushStatus === 'sent') return false;
  return verificationRecordStatus(record) === 'draft';
}

function assertRvZohoInvoiceRecord(record, { preSubmit = false } = {}) {
  if (!record || record.verificationType !== 'RV') {
    throw new Error('Only RV verifications can be invoiced in Zoho.');
  }
  if (record.resubmittedFromId) {
    throw new Error('Resubmitted verifications are not invoiced in Zoho.');
  }
  if (record.zohoInvoiceId) {
    throw new Error('This verification already has a Zoho invoice.');
  }
  const status = verificationRecordStatus(record);
  if (preSubmit) {
    if (status !== 'draft') {
      throw new Error('Pre-submit Zoho invoice requires a draft verification.');
    }
  } else if (status === 'draft') {
    throw new Error('Submit the verification before pushing to Zoho.');
  }
  if (!String(record.applicationNumber || '').trim()) {
    throw new Error('Application number is required for Zoho invoice.');
  }
  if (maximumCapacityKg(record) == null) {
    throw new Error('Maximum capacity is required to select the Zoho product.');
  }
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function assertVerificationZohoAccess(db, uid, record) {
  const callerSnap = await db.doc(`users/${uid}`).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found.');
  }

  const caller = callerSnap.data();
  const rcId = String(record?.rcId || '').trim();
  if (!rcId) {
    throw new HttpsError('failed-precondition', 'Verification is not linked to an RC.');
  }

  if (caller.role === 'super_admin') return;

  if (caller.role === 'rc_admin') {
    if (uid !== rcId) {
      throw new HttpsError('permission-denied', 'Cannot invoice verifications for another RC.');
    }
    return;
  }

  if (caller.role === 'vct') {
    if (caller.rcId !== rcId) {
      throw new HttpsError('permission-denied', 'Cannot invoice verifications for another RC.');
    }
    const approvalStatus = caller.approvalStatus ?? 'approved';
    if (approvalStatus !== 'approved') {
      throw new HttpsError('permission-denied', 'VCT approval required.');
    }
    if (caller.active === false) {
      throw new HttpsError('permission-denied', 'VCT account is inactive.');
    }
    return;
  }

  throw new HttpsError('permission-denied', 'RC or VCT access required.');
}

async function processRvZohoInvoice(db, recordId, record, { allowLegacyPush = false, preSubmit = false } = {}) {
  const settings = await loadZohoRvSettings(db);
  if (!settings.zohoRvInvoicingEnabled && !allowLegacyPush) {
    console.log(`Zoho RV invoicing disabled — skip ${recordId}`);
    return null;
  }

  if (preSubmit) {
    if (!canPushRvZohoInvoicePreSubmit(record)) {
      const error = 'Verification is not eligible for pre-submit Zoho invoicing.';
      if (allowLegacyPush) throw new HttpsError('failed-precondition', error);
      return null;
    }
  }

  assertRvZohoInvoiceRecord(record, { preSubmit });

  const rcSnap = await db.doc(`users/${record.rcId}`).get();
  const rcZohoId = normalizeZohoNumericId(rcSnap.exists ? rcSnap.data()?.zohoId : '');
  if (rcZohoId.length < 10) {
    const error = 'RC Zoho customer ID is missing.';
    await writeZohoPushResult(db, recordId, {
      zohoPushStatus: 'failed',
      zohoPushError: error,
      zohoPushedAt: new Date().toISOString(),
    });
    if (allowLegacyPush) {
      throw new HttpsError('failed-precondition', error);
    }
    return null;
  }

  try {
    const invoice = await createRvInvoice(db, record, rcZohoId, settings);
    await writeZohoPushResult(db, recordId, {
      ...invoice,
      zohoPushStatus: 'sent',
      zohoPushError: null,
      zohoPushedAt: new Date().toISOString(),
    });
    console.log(
      `Zoho invoice sent for ${recordId} (RC ${record.rcId || '—'}, ` +
      `performer ${record.performedBy === 'vct' || record.vctId ? 'vct' : 'rc'}): ` +
      `${invoice.zohoInvoiceNumber || invoice.zohoInvoiceId}`,
    );

    const mergedRecord = {
      ...record,
      ...invoice,
      zohoInvoiceId: invoice.zohoInvoiceId,
      zohoInvoiceNumber: invoice.zohoInvoiceNumber,
      zohoCustomerId: invoice.zohoCustomerId,
      zohoInvoiceTotal: invoice.zohoInvoiceTotal,
    };
    try {
      const { processRvZohoSettlement } = require('./zohoRvSettlement');
      await processRvZohoSettlement(db, recordId, mergedRecord);
    } catch (settlementErr) {
      console.error(`Zoho RV settlement after invoice failed for ${recordId}`, settlementErr);
    }

    return {
      recordId,
      ...invoice,
      zohoPushStatus: 'sent',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Zoho invoice failed.';
    console.error(`Zoho RV invoice failed for ${recordId}`, err);
    await writeZohoPushResult(db, recordId, {
      zohoPushStatus: 'failed',
      zohoPushError: message.slice(0, 500),
      zohoPushedAt: new Date().toISOString(),
    });
    if (allowLegacyPush) {
      throw new HttpsError('internal', message);
    }
    return null;
  }
}

async function triggerRvZohoInvoiceHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const recordId = request.data?.recordId;
  if (!recordId || typeof recordId !== 'string') {
    throw new HttpsError('invalid-argument', 'recordId is required.');
  }

  const snap = await db.doc(`siteCalibrations/${recordId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Verification record not found.');
  }

  const record = snap.data();
  await assertVerificationZohoAccess(db, request.auth.uid, record);

  if (!canPushRvZohoInvoice(record)) {
    return {
      recordId,
      skipped: true,
      reason: 'Verification is not eligible for Zoho invoicing.',
    };
  }

  const result = await processRvZohoInvoice(db, recordId, record);
  if (!result) {
    const fresh = await db.doc(`siteCalibrations/${recordId}`).get();
    const error = fresh.exists ? fresh.data()?.zohoPushError : null;
    throw new HttpsError(
      'internal',
      typeof error === 'string' && error.trim() ? error : 'Zoho invoice push did not complete.',
    );
  }

  return result;
}

async function pushLegacyRvZohoInvoiceHandler(request, db) {
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
  if (!canPushRvZohoInvoice(record)) {
    throw new HttpsError('failed-precondition', 'This verification is not eligible for a legacy Zoho push.');
  }

  const settings = await loadZohoRvSettings(db);
  if (!settings.zohoRvInvoicingEnabled) {
    throw new HttpsError('failed-precondition', 'Zoho RV invoicing is disabled in app settings.');
  }

  const result = await processRvZohoInvoice(db, recordId, record, { allowLegacyPush: true });
  if (!result) {
    throw new HttpsError('internal', 'Zoho invoice push did not complete.');
  }
  return result;
}

async function onSiteCalibrationZohoRvHandler(event, db) {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!shouldProcessRvZohoInvoice(before, after)) return;
  // Submit gate already created the invoice before status became submitted.
  if (after?.zohoInvoiceId) return;

  const recordId = event.params.recordId;
  await processRvZohoInvoice(db, recordId, after);
}

/**
 * RV submit gate — create Zoho invoice while still draft, then mark submitted.
 * Wallet is already debited client-side; Zoho failure leaves the record in draft.
 */
async function submitRvWithZohoGateHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const recordIds = Array.isArray(request.data?.recordIds)
    ? request.data.recordIds.filter(id => typeof id === 'string' && id.trim())
    : [];
  if (!recordIds.length) {
    throw new HttpsError('invalid-argument', 'recordIds is required.');
  }

  const settings = await loadZohoRvSettings(db);
  if (!settings.zohoRvInvoicingEnabled) {
    throw new HttpsError('failed-precondition', 'Zoho RV invoicing is disabled in app settings.');
  }

  const submitted = [];
  const submittedAt = new Date().toISOString();

  for (const recordId of recordIds) {
    const snap = await db.doc(`siteCalibrations/${recordId}`).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Verification ${recordId} not found.`);
    }

    const record = snap.data();
    if (record.verificationType !== 'RV') {
      throw new HttpsError('failed-precondition', 'Only RV verifications use the Zoho submit gate.');
    }
    if (verificationRecordStatus(record) !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        'Only draft RV verifications can be submitted through the Zoho gate.',
      );
    }

    await assertVerificationZohoAccess(db, request.auth.uid, record);

    if (!record.zohoInvoiceId) {
      const invoiceResult = await processRvZohoInvoice(db, recordId, record, { preSubmit: true });
      if (!invoiceResult) {
        const fresh = await db.doc(`siteCalibrations/${recordId}`).get();
        const zohoError = fresh.exists ? fresh.data()?.zohoPushError : null;
        const message = typeof zohoError === 'string' && zohoError.trim()
          ? zohoError.trim()
          : 'Zoho invoice could not be created.';
        throw new HttpsError('failed-precondition', `ZOHO_INVOICE_GATE: ${message}`);
      }
    }

    await db.doc(`siteCalibrations/${recordId}`).set(
      {
        status: 'submitted',
        submittedAt,
        updatedAt: submittedAt,
      },
      { merge: true },
    );

    submitted.push(recordId);
  }

  return {
    recordIds: submitted,
    submittedAt,
    count: submitted.length,
  };
}

module.exports = {
  zohoClientId,
  zohoClientSecret,
  zohoRefreshToken,
  onSiteCalibrationZohoRvHandler,
  triggerRvZohoInvoiceHandler,
  pushLegacyRvZohoInvoiceHandler,
  submitRvWithZohoGateHandler,
  canPushRvZohoInvoice,
  canPushRvZohoInvoicePreSubmit,
  processRvZohoInvoice,
  normalizeZohoRvSettings,
  maximumCapacityKg,
  pickZohoItemId,
  zohoBooksRequest,
  ZOHO_BOOKS_BASE,
};
