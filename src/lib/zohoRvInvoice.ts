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
