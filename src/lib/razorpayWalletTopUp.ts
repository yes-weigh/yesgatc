import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { openRazorpayCheckout as openCheckout } from './razorpayCheckout';

const FUNCTIONS_REGION = 'us-central1';

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

export type WalletTopUpOrderSession = {
  configured: boolean;
  orderId: string;
  walletCreditInr: number;
  grossAmountInr: number;
  amountPaise: number;
  keyId: string;
  serviceChargePercent?: number;
};

export type WalletTopUpPaymentStatus = {
  status: 'created' | 'paid' | 'unknown';
  paidAt?: string;
  topUpId?: string;
  balanceInr?: number;
  razorpayPaymentId?: string;
};

export async function createWalletTopUpOrder(input: {
  walletCreditInr: number;
  note?: string;
  /** Super Admin only — ₹1 test order; no wallet credit. */
  testMode?: boolean;
}): Promise<WalletTopUpOrderSession> {
  const fn = httpsCallable<typeof input, WalletTopUpOrderSession>(
    functionsClient(),
    'createWalletTopUpOrder',
  );
  const result = await fn(input);
  return result.data;
}

export async function getWalletTopUpPaymentStatus(orderId: string): Promise<WalletTopUpPaymentStatus> {
  const fn = httpsCallable<{ orderId: string }, WalletTopUpPaymentStatus>(
    functionsClient(),
    'getWalletTopUpPaymentStatus',
  );
  const result = await fn({ orderId });
  return result.data;
}

export async function verifyWalletTopUpPayment(input: {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<WalletTopUpPaymentStatus> {
  const fn = httpsCallable<typeof input, WalletTopUpPaymentStatus>(
    functionsClient(),
    'verifyWalletTopUpPayment',
  );
  const result = await fn(input);
  return result.data;
}

export async function openWalletTopUpCheckout(
  session: WalletTopUpOrderSession,
  options?: { description?: string },
) {
  return openCheckout({
    keyId: session.keyId,
    amountPaise: session.amountPaise,
    orderId: session.orderId,
    description:
      options?.description
      ?? `Wallet recharge ₹${session.walletCreditInr.toLocaleString('en-IN')}`,
  });
}
