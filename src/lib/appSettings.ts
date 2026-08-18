import {
  normalizeContractorFeeSettings,
  type ContractorFeeSettings,
} from './contractorFeeSettings';
import { normalizeRazorpaySettings, type RazorpaySettings } from './razorpaySettings';
import { normalizeZohoRvSettings, type ZohoRvSettings } from './zohoSettings';

export const APP_SETTINGS_COLLECTION = 'appSettings';
export const APP_SETTINGS_GLOBAL_DOC = 'global';

export type AppGlobalSettings = ZohoRvSettings & RazorpaySettings & ContractorFeeSettings;

export const DEFAULT_APP_SETTINGS: AppGlobalSettings = {
  ...normalizeZohoRvSettings(undefined),
  ...normalizeRazorpaySettings(undefined),
  ...normalizeContractorFeeSettings(undefined),
};

export function normalizeAppSettings(
  data: Partial<AppGlobalSettings> | undefined,
): AppGlobalSettings {
  return {
    ...normalizeZohoRvSettings(data),
    ...normalizeRazorpaySettings(data),
    ...normalizeContractorFeeSettings(data),
  };
}

/** RV verifications always debit RC wallet before submit. */
export function isRvWalletPaymentRequired(verificationType: string): boolean {
  return verificationType === 'RV';
}

export function isRvPaymentRequired(verificationType: string): boolean {
  return isRvWalletPaymentRequired(verificationType);
}
