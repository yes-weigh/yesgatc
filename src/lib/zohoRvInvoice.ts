import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const FUNCTIONS_REGION = 'us-central1';

export type PushLegacyRvZohoInvoiceInput = {
  recordId: string;
};

export type PushLegacyRvZohoInvoiceResult = {
  recordId: string;
  zohoInvoiceId: string;
  zohoInvoiceNumber?: string;
  zohoPushStatus: 'sent';
};

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

export async function pushLegacyRvZohoInvoice(
  input: PushLegacyRvZohoInvoiceInput,
): Promise<PushLegacyRvZohoInvoiceResult> {
  const fn = httpsCallable<PushLegacyRvZohoInvoiceInput, PushLegacyRvZohoInvoiceResult>(
    functionsClient(),
    'pushLegacyRvZohoInvoice',
  );
  const result = await fn(input);
  return result.data;
}

export type TriggerRvZohoInvoiceInput = {
  recordId: string;
};

export type TriggerRvZohoInvoiceResult =
  | PushLegacyRvZohoInvoiceResult
  | { recordId: string; skipped: true; reason: string };

/** Invoked by RC/VCT right after RV submit (backup to the Firestore trigger). */
export async function triggerRvZohoInvoice(
  input: TriggerRvZohoInvoiceInput,
): Promise<TriggerRvZohoInvoiceResult> {
  const fn = httpsCallable<TriggerRvZohoInvoiceInput, TriggerRvZohoInvoiceResult>(
    functionsClient(),
    'triggerRvZohoInvoice',
  );
  const result = await fn(input);
  return result.data;
}

/** Fire-and-forget Zoho invoice push for one or more RV record ids. */
export function queueRvZohoInvoicesAfterSubmit(recordIds: string[]): void {
  if (recordIds.length === 0) return;
  void Promise.allSettled(
    recordIds.map(recordId => triggerRvZohoInvoice({ recordId })),
  );
}

export type PushLegacyRvZohoSettlementInput = {
  recordId: string;
};

export type PushLegacyRvZohoSettlementResult = {
  recordId: string;
  zohoSettlementStatus: 'completed';
  zohoCustomerPaymentStatus?: 'completed' | 'skipped_paid';
  zohoCustomerPaymentId?: string;
  zohoExpenseId?: string;
  zohoExpenseAmountInr?: number;
};

export async function pushLegacyRvZohoSettlement(
  input: PushLegacyRvZohoSettlementInput,
): Promise<PushLegacyRvZohoSettlementResult> {
  const fn = httpsCallable<PushLegacyRvZohoSettlementInput, PushLegacyRvZohoSettlementResult>(
    functionsClient(),
    'pushLegacyRvZohoSettlement',
  );
  const result = await fn(input);
  return result.data;
}

export type ReconcileZohoOutstandingInput = {
  rvLimit?: number;
  rvSettlementLimit?: number;
  walletLimit?: number;
};

export type ReconcileZohoOutstandingResult = {
  rv: { found: number; sent: number; failed: number };
  rvSettlement: { found: number; sent: number; failed: number };
  rvInvoiceRef: { found: number; sent: number; failed: number };
  wallet: { found: number; sent: number; failed: number };
};

export async function reconcileZohoOutstanding(
  input: ReconcileZohoOutstandingInput = {},
): Promise<ReconcileZohoOutstandingResult> {
  const fn = httpsCallable<ReconcileZohoOutstandingInput, ReconcileZohoOutstandingResult>(
    functionsClient(),
    'reconcileZohoOutstanding',
  );
  const result = await fn(input);
  return result.data;
}
