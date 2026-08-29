import {
  normalizeContractorFeeSettings,
  type ContractorFeeSettings,
} from './contractorFeeSettings';
import { normalizeRazorpaySettings, type RazorpaySettings } from './razorpaySettings';
import {
  DEFAULT_YESONE_WEBHOOK_SETTINGS,
  normalizeYesoneWebhookSettings,
  type YesoneWebhookSettings,
} from './yesoneWebhookSettings';
import { normalizeZohoRvSettings, type ZohoRvSettings } from './zohoSettings';

export const APP_SETTINGS_COLLECTION = 'appSettings';
export const APP_SETTINGS_GLOBAL_DOC = 'global';

export type AppGlobalSettings = ZohoRvSettings &
  RazorpaySettings &
  ContractorFeeSettings &
  YesoneWebhookSettings & {
    /** Bump to force RC/VCT/verifier clients to sign out and log in again. */
    authSessionEpoch?: number;
  };

export const DEFAULT_APP_SETTINGS: AppGlobalSettings = {
  ...normalizeZohoRvSettings(undefined),
  ...normalizeRazorpaySettings(undefined),
  ...normalizeContractorFeeSettings(undefined),
  ...DEFAULT_YESONE_WEBHOOK_SETTINGS,
  authSessionEpoch: 0,
};

export function normalizeAppSettings(
  data: Partial<AppGlobalSettings> | undefined,
): AppGlobalSettings {
  const epochRaw = data?.authSessionEpoch;
  const authSessionEpoch =
    typeof epochRaw === 'number' && Number.isFinite(epochRaw) && epochRaw >= 0
      ? Math.floor(epochRaw)
      : 0;
  return {
    ...normalizeZohoRvSettings(data),
    ...normalizeRazorpaySettings(data),
    ...normalizeContractorFeeSettings(data),
    ...normalizeYesoneWebhookSettings(data),
    authSessionEpoch,
  };
}

/** RV verifications always debit RC wallet before submit. */
export function isRvWalletPaymentRequired(verificationType: string): boolean {
  return verificationType === 'RV';
}

export function isRvPaymentRequired(verificationType: string): boolean {
  return isRvWalletPaymentRequired(verificationType);
}
