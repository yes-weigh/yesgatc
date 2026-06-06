const { defineSecret } = require('firebase-functions/params');
const { HttpsError } = require('firebase-functions/v2/https');

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

function buildLineDescription(record) {
  const parts = [];
  if (record.serialNumber) parts.push(`Serial ${record.serialNumber}`);
  if (record.productName) parts.push(record.productName);
  if (record.customerName) parts.push(record.customerName);
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

async function createRvInvoice(record, rcZohoId, settings) {
  const itemId = pickZohoItemId(record, settings);
  const applicationNumber = String(record.applicationNumber || '').trim();
  if (!applicationNumber) {
    throw new Error('applicationNumber is required for Zoho invoice.');
  }

  const invoiceBody = {
    customer_id: rcZohoId,
    salesperson_id: settings.zohoSalespersonId,
    date: (record.submittedAt || new Date().toISOString()).slice(0, 10),
    line_items: [
      {
        item_id: itemId,
        quantity: 1,
        description: buildLineDescription(record),
      },
    ],
    custom_fields: [
      { api_name: 'cf_gatc_ref_no', value: applicationNumber },
      { api_name: 'cf_mode_of_transport', value: settings.zohoModeOfTransport },
    ],
  };

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

function assertRvZohoInvoiceRecord(record) {
  if (!record || record.verificationType !== 'RV') {
    throw new Error('Only RV verifications can be invoiced in Zoho.');
  }
  if (record.resubmittedFromId) {
    throw new Error('Resubmitted verifications are not invoiced in Zoho.');
  }
  if (record.zohoInvoiceId) {
    throw new Error('This verification already has a Zoho invoice.');
  }
  if (verificationRecordStatus(record) === 'draft') {
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

async function processRvZohoInvoice(db, recordId, record, { allowLegacyPush = false } = {}) {
  const settings = await loadZohoRvSettings(db);
  if (!settings.zohoRvInvoicingEnabled && !allowLegacyPush) {
    console.log(`Zoho RV invoicing disabled — skip ${recordId}`);
    return null;
  }

  assertRvZohoInvoiceRecord(record);

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
    const invoice = await createRvInvoice(record, rcZohoId, settings);
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

  const recordId = event.params.recordId;
  await processRvZohoInvoice(db, recordId, after);
}

module.exports = {
  zohoClientId,
  zohoClientSecret,
  zohoRefreshToken,
  onSiteCalibrationZohoRvHandler,
  triggerRvZohoInvoiceHandler,
  pushLegacyRvZohoInvoiceHandler,
  canPushRvZohoInvoice,
  processRvZohoInvoice,
  normalizeZohoRvSettings,
  maximumCapacityKg,
  pickZohoItemId,
  zohoBooksRequest,
  ZOHO_BOOKS_BASE,
};
