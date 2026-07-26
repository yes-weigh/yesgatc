import { normalizeRazorpaySettings, type RazorpaySettings } from './razorpaySettings';
import { normalizeZohoRvSettings, type ZohoRvSettings } from './zohoSettings';

export const APP_SETTINGS_COLLECTION = 'appSettings';
export const APP_SETTINGS_GLOBAL_DOC = 'global';

export type OvInterweighSettings = {
  /** When true, verifications are OV-only at the fixed Interweighing Cochin address. */
  ovInterweighOnlyEnabled: boolean;
  /** Fixed site latitude for photo geo-stamps when Interweigh-only mode is on. */
  ovInterweighLatitude: number | null;
  /** Fixed site longitude for photo geo-stamps when Interweigh-only mode is on. */
  ovInterweighLongitude: number | null;
};

export type AppGlobalSettings = ZohoRvSettings & RazorpaySettings & OvInterweighSettings;

export const DEFAULT_OV_INTERWEIGH_SETTINGS: OvInterweighSettings = {
  ovInterweighOnlyEnabled: false,
  ovInterweighLatitude: null,
  ovInterweighLongitude: null,
};

export const DEFAULT_APP_SETTINGS: AppGlobalSettings = {
  ...normalizeZohoRvSettings(undefined),
  ...normalizeRazorpaySettings(undefined),
  ...DEFAULT_OV_INTERWEIGH_SETTINGS,
};

function normalizeOptionalCoord(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeOvInterweighSettings(
  data: Partial<OvInterweighSettings> | undefined,
): OvInterweighSettings {
  return {
    ovInterweighOnlyEnabled: data?.ovInterweighOnlyEnabled === true,
    ovInterweighLatitude: normalizeOptionalCoord(data?.ovInterweighLatitude),
    ovInterweighLongitude: normalizeOptionalCoord(data?.ovInterweighLongitude),
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
