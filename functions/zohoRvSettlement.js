const { HttpsError } = require('firebase-functions/v2/https');
const {
  zohoBooksRequest,
  maximumCapacityKg,
  normalizeZohoRvSettings,
} = require('./zohoRv');
const { normalizeZohoWalletSettings } = require('./zohoWallet');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';

const RV_LABOUR_PAYOUT_UPTO_20_KG = 135;
const RV_LABOUR_PAYOUT_ABOVE_20_KG = 225;
const RV_ZOHO_PAYMENT_MODE = 'Bank Transfer';
const INVOICE_BALANCE_TOLERANCE = 0.009;

function normalizeZohoNumericId(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function rvLabourPayoutInr(record) {
  const capacityKg = maximumCapacityKg(record);
  if (capacityKg == null) {
    throw new Error('Maximum capacity is required for RV labour payout.');
  }
  return capacityKg <= 20 ? RV_LABOUR_PAYOUT_UPTO_20_KG : RV_LABOUR_PAYOUT_ABOVE_20_KG;
}

function rvSettlementReference(prefix, applicationNumber) {
  const safe = String(applicationNumber || '')
    .replace(/[^\w/.-]/g, '')
    .slice(0, 40);
  return `${prefix}${safe || 'UNKNOWN'}`;
}

function rvPaymentReference(applicationNumber) {
  return rvSettlementReference('RV-PAY-', applicationNumber);
}

function rvLabourReference(applicationNumber) {
  return rvSettlementReference('RV-LAB-', applicationNumber);
}

function settlementDate(record) {
  const iso = record.submittedAt || record.zohoPushedAt || new Date().toISOString();
  return String(iso).slice(0, 10);
}

async function loadZohoSettlementSettings(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  const data = snap.exists ? snap.data() : undefined;
  const rv = normalizeZohoRvSettings(data);
  const wallet = normalizeZohoWalletSettings(data);
  return {
    zohoRvSettlementEnabled: data?.zohoRvSettlementEnabled !== false,
    zohoOrganizationId: rv.zohoOrganizationId,
    zohoGatcWalletAccountId: wallet.zohoWalletFromAccountId,
  };
}

async function fetchZohoInvoice(invoiceId, settings) {
  const response = await zohoBooksRequest(
    `/invoices/${invoiceId}?organization_id=${settings.zohoOrganizationId}`,
    { logLabel: 'settlement-get-invoice' },
  );
  const invoice = response.invoice;
  if (!invoice?.invoice_id) {
    throw new Error('Zoho invoice lookup did not return invoice_id.');
  }
  return invoice;
}

async function findCustomerPaymentByReference(referenceNumber, settings) {
  const response = await zohoBooksRequest(
    `/customerpayments?organization_id=${settings.zohoOrganizationId}&reference_number=${encodeURIComponent(referenceNumber)}`,
    { logLabel: 'settlement-find-payment' },
  );
  const payments = Array.isArray(response.customerpayments) ? response.customerpayments : [];
  return payments[0] || null;
}

async function findExpenseByReference(referenceNumber, settings) {
  const response = await zohoBooksRequest(
    `/expenses?organization_id=${settings.zohoOrganizationId}&reference_number=${encodeURIComponent(referenceNumber)}`,
    { logLabel: 'settlement-find-expense' },
  );
  const expenses = Array.isArray(response.expenses) ? response.expenses : [];
  return expenses[0] || null;
}

/** Links a one-off manual expense when only one matches account, amount, and date. */
async function findUniqueLabourExpenseByAmountAndDate({
  expenseAccountId,
  amountInr,
  expenseDate,
  settings,
}) {
  const response = await zohoBooksRequest(
    `/expenses?organization_id=${settings.zohoOrganizationId}&date_start=${expenseDate}&date_end=${expenseDate}`,
    { logLabel: 'settlement-find-expense-by-date' },
  );
  const expenses = Array.isArray(response.expenses) ? response.expenses : [];
  const matches = expenses.filter(expense => (
    normalizeZohoNumericId(expense.account_id) === expenseAccountId
    && Math.abs(Number(expense.total) - amountInr) < 0.01
  ));
  return matches.length === 1 ? matches[0] : null;
}

async function createRvCustomerPayment({
  record,
  customerId,
  invoice,
  amountInr,
  paymentDate,
  referenceNumber,
  settings,
}) {
  const body = {
    customer_id: customerId,
    payment_mode: RV_ZOHO_PAYMENT_MODE,
    amount: amountInr,
    date: paymentDate,
    reference_number: referenceNumber,
    account_id: settings.zohoGatcWalletAccountId,
    description: `RV payment ${invoice.invoice_number || record.zohoInvoiceNumber || ''} (${record.applicationNumber})`.trim(),
    exchange_rate: 1,
    invoices: [
      {
        invoice_id: invoice.invoice_id,
        amount_applied: amountInr,
      },
    ],
  };

  const created = await zohoBooksRequest(
    `/customerpayments?organization_id=${settings.zohoOrganizationId}`,
    { method: 'POST', body, logLabel: 'settlement-customer-payment' },
  );

  const payment = created.payment;
  if (!payment?.payment_id) {
    throw new Error('Zoho customer payment response did not include payment_id.');
  }
  return payment;
}

async function createRvLabourExpense({
  record,
  expenseAccountId,
  amountInr,
  expenseDate,
  referenceNumber,
  settings,
}) {
  const body = {
    account_id: expenseAccountId,
    paid_through_account_id: settings.zohoGatcWalletAccountId,
    amount: amountInr,
    date: expenseDate,
    reference_number: referenceNumber,
    description: `RV labour payout ${record.applicationNumber}`.trim(),
    is_inclusive_tax: false,
  };

  const created = await zohoBooksRequest(
    `/expenses?organization_id=${settings.zohoOrganizationId}`,
    { method: 'POST', body, logLabel: 'settlement-labour-expense' },
  );

  const expense = created.expense;
  if (!expense?.expense_id) {
    throw new Error('Zoho expense response did not include expense_id.');
  }
  return expense;
}

async function writeRvSettlementResult(db, recordId, patch) {
  await db.doc(`siteCalibrations/${recordId}`).set(
    {
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

function canSettleRvZoho(record) {
  if (!record || record.verificationType !== 'RV') return false;
  if (record.resubmittedFromId) return false;
  if (!String(record.zohoInvoiceId || '').trim()) return false;
  if (record.zohoSettlementStatus === 'completed') return false;
  return true;
}

function assertRvSettlementRecord(record) {
  if (!record || record.verificationType !== 'RV') {
    throw new Error('Only RV verifications can be settled in Zoho.');
  }
  if (record.resubmittedFromId) {
    throw new Error('Resubmitted verifications are not settled in Zoho.');
  }
  if (!String(record.zohoInvoiceId || '').trim()) {
    throw new Error('Zoho invoice is required before settlement.');
  }
  if (!String(record.applicationNumber || '').trim()) {
    throw new Error('Application number is required for Zoho settlement.');
  }
}

async function processRvZohoSettlement(db, recordId, record, { allowLegacyPush = false } = {}) {
  const settings = await loadZohoSettlementSettings(db);
  if (!settings.zohoRvSettlementEnabled && !allowLegacyPush) {
    console.log(`Zoho RV settlement disabled — skip ${recordId}`);
    return null;
  }

  if (!canSettleRvZoho(record)) {
    if (allowLegacyPush) {
      throw new HttpsError('failed-precondition', 'This verification is not eligible for Zoho settlement.');
    }
    return null;
  }

  assertRvSettlementRecord(record);

  if (settings.zohoGatcWalletAccountId.length < 10) {
    const error = 'GATC Wallet account ID is not configured in Admin Zoho settings.';
    await writeRvSettlementResult(db, recordId, {
      zohoSettlementStatus: 'failed',
      zohoSettlementError: error,
      zohoSettledAt: new Date().toISOString(),
    });
    if (allowLegacyPush) throw new HttpsError('failed-precondition', error);
    return null;
  }

  const rcSnap = await db.doc(`users/${record.rcId}`).get();
  const rcData = rcSnap.exists ? rcSnap.data() : null;
  const customerId = normalizeZohoNumericId(record.zohoCustomerId || rcData?.zohoId || '');
  const expenseAccountId = normalizeZohoNumericId(rcData?.zohoVendorId || '');

  if (customerId.length < 10) {
    const error = 'RC Zoho customer ID is missing.';
    await writeRvSettlementResult(db, recordId, {
      zohoSettlementStatus: 'failed',
      zohoSettlementError: error,
      zohoSettledAt: new Date().toISOString(),
    });
    if (allowLegacyPush) throw new HttpsError('failed-precondition', error);
    return null;
  }

  if (expenseAccountId.length < 10) {
    const error = 'RC Zoho labour expense account ID is missing (stored as vendor ID on RC profile).';
    await writeRvSettlementResult(db, recordId, {
      zohoSettlementStatus: 'failed',
      zohoSettlementError: error,
      zohoSettledAt: new Date().toISOString(),
    });
    if (allowLegacyPush) throw new HttpsError('failed-precondition', error);
    return null;
  }

  const paymentDate = settlementDate(record);
  const payReference = rvPaymentReference(record.applicationNumber);
  const labReference = rvLabourReference(record.applicationNumber);
  const payoutInr = rvLabourPayoutInr(record);
  const settledAt = new Date().toISOString();

  const result = {
    zohoCustomerPaymentId: record.zohoCustomerPaymentId || undefined,
    zohoCustomerPaymentStatus: record.zohoCustomerPaymentStatus || undefined,
    zohoCustomerPaymentAmountInr: record.zohoCustomerPaymentAmountInr ?? undefined,
    zohoExpenseId: record.zohoExpenseId || undefined,
    zohoExpenseStatus: record.zohoExpenseStatus || undefined,
    zohoExpenseAmountInr: record.zohoExpenseAmountInr ?? undefined,
    zohoSettlementStatus: 'completed',
    zohoSettlementError: null,
    zohoSettledAt: settledAt,
  };

  try {
    const invoice = await fetchZohoInvoice(record.zohoInvoiceId, settings);
    const invoiceBalance = Number(invoice.balance ?? 0);

    if (result.zohoCustomerPaymentId) {
      result.zohoCustomerPaymentStatus = result.zohoCustomerPaymentStatus || 'completed';
    } else {
      const existingPayment = await findCustomerPaymentByReference(payReference, settings);
      if (existingPayment?.payment_id) {
        result.zohoCustomerPaymentId = String(existingPayment.payment_id);
        result.zohoCustomerPaymentStatus = 'completed';
        result.zohoCustomerPaymentAmountInr = Number(existingPayment.amount ?? invoiceBalance);
      } else if (invoiceBalance <= INVOICE_BALANCE_TOLERANCE) {
        result.zohoCustomerPaymentStatus = 'skipped_paid';
        result.zohoCustomerPaymentAmountInr = Number(invoice.total ?? record.zohoInvoiceTotal ?? 0);
      } else {
        const amountInr = Math.min(invoiceBalance, Number(invoice.total ?? invoiceBalance));
        if (!Number.isFinite(amountInr) || amountInr <= 0) {
          throw new Error('Invoice balance is not payable.');
        }
        const payment = await createRvCustomerPayment({
          record,
          customerId,
          invoice,
          amountInr,
          paymentDate,
          referenceNumber: payReference,
          settings,
        });
        result.zohoCustomerPaymentId = String(payment.payment_id);
        result.zohoCustomerPaymentStatus = 'completed';
        result.zohoCustomerPaymentAmountInr = amountInr;
      }
    }

    if (result.zohoExpenseId) {
      result.zohoExpenseStatus = result.zohoExpenseStatus || 'completed';
    } else {
      let existingExpense = await findExpenseByReference(labReference, settings);
      if (!existingExpense?.expense_id) {
        existingExpense = await findUniqueLabourExpenseByAmountAndDate({
          expenseAccountId,
          amountInr: payoutInr,
          expenseDate: paymentDate,
          settings,
        });
      }
      if (existingExpense?.expense_id) {
        result.zohoExpenseId = String(existingExpense.expense_id);
        result.zohoExpenseStatus = 'completed';
        result.zohoExpenseAmountInr = Number(existingExpense.total ?? payoutInr);
      } else {
        const expense = await createRvLabourExpense({
          record,
          expenseAccountId,
          amountInr: payoutInr,
          expenseDate: paymentDate,
          referenceNumber: labReference,
          settings,
        });
        result.zohoExpenseId = String(expense.expense_id);
        result.zohoExpenseStatus = 'completed';
        result.zohoExpenseAmountInr = payoutInr;
      }
    }

    await writeRvSettlementResult(db, recordId, result);
    console.log(
      `Zoho RV settlement for ${recordId}: payment=${result.zohoCustomerPaymentStatus}, ` +
      `expense=${result.zohoExpenseId || '—'}, labour=₹${result.zohoExpenseAmountInr}`,
    );
    return { recordId, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Zoho RV settlement failed.';
    console.error(`Zoho RV settlement failed for ${recordId}`, err);
    await writeRvSettlementResult(db, recordId, {
      zohoSettlementStatus: 'failed',
      zohoSettlementError: message.slice(0, 500),
      zohoSettledAt: settledAt,
      zohoCustomerPaymentStatus: result.zohoCustomerPaymentStatus || record.zohoCustomerPaymentStatus,
      zohoExpenseStatus: result.zohoExpenseStatus || record.zohoExpenseStatus,
    });
    if (allowLegacyPush) {
      throw new HttpsError('internal', message);
    }
    return null;
  }
}

async function assertSuperAdmin(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.data().role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }
}

async function pushLegacyRvZohoSettlementHandler(request, db) {
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
  const settings = await loadZohoSettlementSettings(db);
  if (!settings.zohoRvSettlementEnabled) {
    throw new HttpsError('failed-precondition', 'Zoho RV settlement is disabled in app settings.');
  }

  const result = await processRvZohoSettlement(db, recordId, record, { allowLegacyPush: true });
  if (!result) {
    throw new HttpsError('internal', 'Zoho settlement did not complete.');
  }
  return result;
}

module.exports = {
  processRvZohoSettlement,
  canSettleRvZoho,
  pushLegacyRvZohoSettlementHandler,
  rvLabourPayoutInr,
  rvPaymentReference,
  rvLabourReference,
};
