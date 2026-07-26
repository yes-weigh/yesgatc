import { normalizeRazorpaySettings, type RazorpaySettings } from './razorpaySettings';
import { normalizeZohoRvSettings, type ZohoRvSettings } from './zohoSettings';

export const APP_SETTINGS_COLLECTION = 'appSettings';
export const APP_SETTINGS_GLOBAL_DOC = 'global';

export type OvInterweighSettings = {
  /** When true, verifications are OV-only at the fixed Interweighing Cochin address. */
  ovInterweighOnlyEnabled: boolean;
};

export type AppGlobalSettings = ZohoRvSettings & RazorpaySettings & OvInterweighSettings;

export const DEFAULT_OV_INTERWEIGH_SETTINGS: OvInterweighSettings = {
  ovInterweighOnlyEnabled: false,
};

export const DEFAULT_APP_SETTINGS: AppGlobalSettings = {
  ...normalizeZohoRvSettings(undefined),
  ...normalizeRazorpaySettings(undefined),
  ...DEFAULT_OV_INTERWEIGH_SETTINGS,
};

export function normalizeOvInterweighSettings(
  data: Partial<OvInterweighSettings> | undefined,
): OvInterweighSettings {
  return {
    ovInterweighOnlyEnabled: data?.ovInterweighOnlyEnabled === true,
  };
}

export function normalizeAppSettings(
  data: Partial<AppGlobalSettings> | undefined,
): AppGlobalSettings {
  return {
    ...normalizeZohoRvSettings(data),
    ...normalizeRazorpaySettings(data),
    ...normalizeOvInterweighSettings(data),
  };
}

/** RV verifications always debit RC wallet before submit. */
export function isRvWalletPaymentRequired(verificationType: string): boolean {
  return verificationType === 'RV';
}

export function isRvPaymentRequired(verificationType: string): boolean {
  return isRvWalletPaymentRequired(verificationType);
}
