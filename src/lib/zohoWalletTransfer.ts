import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { WalletTopUp } from '../types';

const FUNCTIONS_REGION = 'us-central1';

export type PushLegacyWalletTopUpZohoTransferInput = {
  topUpId: string;
};

export type PushLegacyWalletTopUpZohoTransferResult = {
  topUpId: string;
  zohoTransferStatus: 'completed';
  zohoTransactionId: string;
  zohoReferenceNumber?: string;
  zohoTransferDescription?: string;
  zohoFromAccountName?: string;
  zohoToAccountName?: string;
  zohoTransferDate?: string;
};

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

/** Approved top-up not yet recorded as GATC Wallet → Kotak in Zoho Books. */
export function isWalletTopUpZohoTransferOutstanding(
  topUp: Pick<WalletTopUp, 'status' | 'zohoTransferStatus' | 'zohoTransactionId'> | null | undefined,
): boolean {
  if (!topUp || topUp.status !== 'approved') return false;
  if (topUp.zohoTransferStatus === 'completed' && topUp.zohoTransactionId?.trim()) {
    return false;
  }
  return true;
}

export async function pushLegacyWalletTopUpZohoTransfer(
  input: PushLegacyWalletTopUpZohoTransferInput,
): Promise<PushLegacyWalletTopUpZohoTransferResult> {
  const fn = httpsCallable<
    PushLegacyWalletTopUpZohoTransferInput,
    PushLegacyWalletTopUpZohoTransferResult
  >(functionsClient(), 'pushLegacyWalletTopUpZohoTransfer');
  const result = await fn(input);
  return result.data;
}
