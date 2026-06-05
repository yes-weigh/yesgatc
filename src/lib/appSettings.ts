export const APP_SETTINGS_COLLECTION = 'appSettings';
export const APP_SETTINGS_GLOBAL_DOC = 'global';

export type AppGlobalSettings = {
  /** When true, RV submit requires Razorpay before certification. */
  rvRazorpayEnabled: boolean;
};

export const DEFAULT_APP_SETTINGS: AppGlobalSettings = {
  rvRazorpayEnabled: false,
};

export function normalizeAppSettings(
  data: Partial<AppGlobalSettings> | undefined,
): AppGlobalSettings {
  return {
    rvRazorpayEnabled: data?.rvRazorpayEnabled === true,
  };
}

export function isRvRazorpayPaymentRequired(
  verificationType: string,
  settings: AppGlobalSettings,
): boolean {
  return verificationType === 'RV' && settings.rvRazorpayEnabled;
}
