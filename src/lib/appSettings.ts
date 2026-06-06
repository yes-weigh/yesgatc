export const APP_SETTINGS_COLLECTION = 'appSettings';
export const APP_SETTINGS_GLOBAL_DOC = 'global';

export type AppGlobalSettings = {
  /** When true, RV submit requires Razorpay before certification. */
  rvRazorpayEnabled: boolean;
  /** When true, RV submit debits RC wallet balance (alternative to Razorpay). */
  rvWalletEnabled: boolean;
};

export const DEFAULT_APP_SETTINGS: AppGlobalSettings = {
  rvRazorpayEnabled: false,
  rvWalletEnabled: false,
};

export function normalizeAppSettings(
  data: Partial<AppGlobalSettings> | undefined,
): AppGlobalSettings {
  return {
    rvRazorpayEnabled: data?.rvRazorpayEnabled === true,
    rvWalletEnabled: data?.rvWalletEnabled === true,
  };
}

export function isRvRazorpayPaymentRequired(
  verificationType: string,
  settings: AppGlobalSettings,
): boolean {
  return verificationType === 'RV' && settings.rvRazorpayEnabled && !settings.rvWalletEnabled;
}

export function isRvWalletPaymentRequired(
  verificationType: string,
  settings: AppGlobalSettings,
): boolean {
  return verificationType === 'RV' && settings.rvWalletEnabled;
}

export function isRvPaymentRequired(
  verificationType: string,
  settings: AppGlobalSettings,
): boolean {
  return isRvRazorpayPaymentRequired(verificationType, settings)
    || isRvWalletPaymentRequired(verificationType, settings);
}
