import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { RvPaymentBreakdown } from './rvPaymentAmount';

const FUNCTIONS_REGION = 'us-central1';

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

export type RvPaymentSession = {
  paymentId: string;
  orderId: string;
  amountInr: number;
  amountPaise: number;
  keyId: string;
  qrImageUrl: string | null;
  configured: boolean;
};

export type RvPaymentStatusResult = {
  status: 'created' | 'paid' | 'expired' | 'unknown';
  paidAt?: string;
  razorpayPaymentId?: string;
};

let razorpayScriptPromise: Promise<void> | null = null;

export function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout.'));
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
}

export async function createRvPaymentOrder(input: {
  amountInr: number;
  rcId: string;
  recordIds?: string[];
  breakdown: RvPaymentBreakdown;
}): Promise<RvPaymentSession> {
  const fn = httpsCallable<typeof input, RvPaymentSession>(
    functionsClient(),
    'createRvPaymentOrder',
  );
  const result = await fn(input);
  return result.data;
}

export async function getRvPaymentStatus(paymentId: string): Promise<RvPaymentStatusResult> {
  const fn = httpsCallable<{ paymentId: string }, RvPaymentStatusResult>(
    functionsClient(),
    'getRvPaymentStatus',
  );
  const result = await fn({ paymentId });
  return result.data;
}

export async function verifyRvPayment(input: {
  paymentId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<RvPaymentStatusResult> {
  const fn = httpsCallable<typeof input, RvPaymentStatusResult>(
    functionsClient(),
    'verifyRvPayment',
  );
  const result = await fn(input);
  return result.data;
}

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpayCheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
    };
  }
}

export async function openRazorpayCheckout(session: RvPaymentSession): Promise<RazorpayCheckoutResponse> {
  if (!session.keyId?.trim()) {
    throw new Error('Razorpay checkout key is missing from the payment session.');
  }

  await loadRazorpayCheckoutScript();
  if (!window.Razorpay) {
    throw new Error('Razorpay checkout is unavailable.');
  }

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay!({
      key: session.keyId.trim(),
      amount: session.amountPaise,
      currency: 'INR',
      name: 'YesGATC',
      description: 'RV administrative fees + GST',
      order_id: session.orderId,
      theme: { color: '#22c55e' },
      handler: response => resolve(response),
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled.')),
      },
    });
    checkout.open();
  });
}
