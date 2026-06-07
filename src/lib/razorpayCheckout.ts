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

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  theme?: { color?: string };
  handler: (response: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
    };
  }
}

export async function openRazorpayCheckout(input: {
  keyId: string;
  amountPaise: number;
  orderId: string;
  description: string;
  name?: string;
  themeColor?: string;
}): Promise<{
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}> {
  if (!input.keyId.trim()) {
    throw new Error('Razorpay checkout key is missing.');
  }

  await loadRazorpayCheckoutScript();
  if (!window.Razorpay) {
    throw new Error('Razorpay checkout is unavailable.');
  }

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay!({
      key: input.keyId.trim(),
      amount: input.amountPaise,
      currency: 'INR',
      name: input.name ?? 'YesGATC',
      description: input.description,
      order_id: input.orderId,
      theme: { color: input.themeColor ?? '#3395ff' },
      handler: response => resolve(response),
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled.')),
      },
    });
    checkout.open();
  });
}
