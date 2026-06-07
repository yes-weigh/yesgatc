import { normalizeZohoNumericId } from './zohoSettings';

export type WalletRechargeMode = 'manual' | 'razorpay';

export type RazorpaySettings = {
  /** Manual screenshot approval vs Razorpay auto-credit for wallet recharge. */
  walletRechargeMode: WalletRechargeMode;
  /** PG service charge passed to customer on wallet recharge (e.g. 2 = 2%). */
  razorpayServiceChargePercent: number;
  /** Minimum whole-rupee amount RC can request for wallet credit. */
  razorpayMinWalletRechargeInr: number;
  /** Zoho Books bank account for Razorpay collections (GATC Wallet → Razorpay transfer). */
  zohoRazorpayAccountId: string;
};

export const DEFAULT_RAZORPAY_SETTINGS: RazorpaySettings = {
  walletRechargeMode: 'manual',
  razorpayServiceChargePercent: 2,
  razorpayMinWalletRechargeInr: 1,
  zohoRazorpayAccountId: '99381000005573106',
};

function normalizeWalletRechargeMode(value: unknown): WalletRechargeMode {
  return value === 'razorpay' ? 'razorpay' : 'manual';
}

function clampServiceChargePercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RAZORPAY_SETTINGS.razorpayServiceChargePercent;
  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
}

function clampMinWalletRechargeInr(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_RAZORPAY_SETTINGS.razorpayMinWalletRechargeInr;
  }
  return Math.floor(parsed);
}

export function normalizeRazorpaySettings(
  data: Partial<RazorpaySettings> | undefined,
): RazorpaySettings {
  const accountId =
    normalizeZohoNumericId(data?.zohoRazorpayAccountId ?? '')
    || DEFAULT_RAZORPAY_SETTINGS.zohoRazorpayAccountId;

  return {
    walletRechargeMode: normalizeWalletRechargeMode(data?.walletRechargeMode),
    razorpayServiceChargePercent: clampServiceChargePercent(data?.razorpayServiceChargePercent),
    razorpayMinWalletRechargeInr: clampMinWalletRechargeInr(data?.razorpayMinWalletRechargeInr),
    zohoRazorpayAccountId: accountId,
  };
}

export function isManualWalletRechargeMode(
  settings: Pick<RazorpaySettings, 'walletRechargeMode'> | null | undefined,
): boolean {
  return normalizeWalletRechargeMode(settings?.walletRechargeMode) === 'manual';
}

export function isRazorpayWalletRechargeMode(
  settings: Pick<RazorpaySettings, 'walletRechargeMode'> | null | undefined,
): boolean {
  return normalizeWalletRechargeMode(settings?.walletRechargeMode) === 'razorpay';
}

export type RazorpaySettingsFormValues = {
  walletRechargeMode: WalletRechargeMode;
  razorpayServiceChargePercent: string;
  razorpayMinWalletRechargeInr: string;
  zohoRazorpayAccountId: string;
};

export function razorpaySettingsToFormValues(settings: RazorpaySettings): RazorpaySettingsFormValues {
  return {
    walletRechargeMode: settings.walletRechargeMode,
    razorpayServiceChargePercent: String(settings.razorpayServiceChargePercent),
    razorpayMinWalletRechargeInr: String(settings.razorpayMinWalletRechargeInr),
    zohoRazorpayAccountId: settings.zohoRazorpayAccountId,
  };
}

export function validateRazorpaySettingsForm(values: RazorpaySettingsFormValues): string | null {
  const percent = Number(values.razorpayServiceChargePercent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return 'Service charge must be between 0 and 100%.';
  }

  const minRecharge = Number(values.razorpayMinWalletRechargeInr);
  if (!Number.isFinite(minRecharge) || minRecharge < 1 || !Number.isInteger(minRecharge)) {
    return 'Minimum wallet recharge must be a whole number of at least ₹1.';
  }

  const accountId = normalizeZohoNumericId(values.zohoRazorpayAccountId);
  if (accountId.length < 10) {
    return 'Zoho Razorpay account ID must be at least 10 digits.';
  }

  return null;
}

export function razorpaySettingsFromForm(values: RazorpaySettingsFormValues): RazorpaySettings {
  return normalizeRazorpaySettings({
    walletRechargeMode: values.walletRechargeMode,
    razorpayServiceChargePercent: Number(values.razorpayServiceChargePercent),
    razorpayMinWalletRechargeInr: Number(values.razorpayMinWalletRechargeInr),
    zohoRazorpayAccountId: values.zohoRazorpayAccountId,
  });
}

/** Whole rupees charged on Razorpay when RC requests `walletCreditInr` credit. */
export function walletRechargeGrossInr(
  walletCreditInr: number,
  serviceChargePercent: number,
): number {
  const credit = Math.floor(walletCreditInr);
  if (credit < 1) return 0;
  const multiplier = 1 + clampServiceChargePercent(serviceChargePercent) / 100;
  return Math.round(credit * multiplier);
}
