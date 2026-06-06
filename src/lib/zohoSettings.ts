export type ZohoRvSettings = {
  /** When true, RV submit requires RC zohoId and triggers Zoho invoice on submit. */
  zohoRvInvoicingEnabled: boolean;
  zohoOrganizationId: string;
  zohoSalespersonId: string;
  zohoItemIdUpto20Kg: string;
  zohoItemIdAbove20Kg: string;
  zohoModeOfTransport: string;
  /** When true, wallet top-up approval posts GATC Wallet → Kotak transfer in Zoho Books. */
  zohoWalletTransferEnabled: boolean;
  /** Source bank account (e.g. GATC Wallet). */
  zohoWalletFromAccountId: string;
  /** Destination bank account (e.g. Kotak Current Account). */
  zohoWalletToAccountId: string;
  /** When true, a scheduled job every 30 minutes pushes outstanding RV invoices and wallet transfers. */
  zohoReconcileEnabled: boolean;
  /** When true, after RV invoice: customer payment → GATC Wallet + labour expense payout. */
  zohoRvSettlementEnabled: boolean;
};

/** Exact dropdown labels from Zoho Books `cf_mode_of_transport` (invoice custom field). */
export const ZOHO_MODE_OF_TRANSPORT_OPTIONS = [
  'CUSTOMER PICKUP',
  'With Machine',
  'Indian Post',
  'DTDC',
  'BLUEDART',
  'Delhivery',
  'GATI',
  'VRL',
  'TCI',
  'Cloud',
] as const;

export type ZohoModeOfTransportOption = (typeof ZOHO_MODE_OF_TRANSPORT_OPTIONS)[number];

const ZOHO_MODE_OF_TRANSPORT_ALIASES: Record<string, ZohoModeOfTransportOption> = {
  'without machine': 'CUSTOMER PICKUP',
  'with machine': 'With Machine',
};

/** Maps legacy labels to a valid Zoho dropdown value (case-insensitive for known aliases). */
export function resolveZohoModeOfTransport(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return DEFAULT_ZOHO_RV_SETTINGS.zohoModeOfTransport;
  const alias = ZOHO_MODE_OF_TRANSPORT_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return trimmed;
}

export const DEFAULT_ZOHO_RV_SETTINGS: ZohoRvSettings = {
  zohoRvInvoicingEnabled: true,
  zohoOrganizationId: '60001225303',
  zohoSalespersonId: '99381000030360028',
  zohoItemIdUpto20Kg: '99381000030360012',
  zohoItemIdAbove20Kg: '99381000030360017',
  /** Closest Zoho option to “without machine” — `Without Machine` is not in the dropdown. */
  zohoModeOfTransport: 'CUSTOMER PICKUP',
  zohoWalletTransferEnabled: true,
  zohoWalletFromAccountId: '99381000030412002',
  zohoWalletToAccountId: '99381000000006234',
  zohoReconcileEnabled: true,
  zohoRvSettlementEnabled: true,
};

export function normalizeZohoNumericId(input: string): string {
  return input.replace(/\D/g, '');
}

export function normalizeZohoRvSettings(
  data: Partial<ZohoRvSettings> | undefined,
): ZohoRvSettings {
  return {
    zohoRvInvoicingEnabled: data?.zohoRvInvoicingEnabled !== false,
    zohoOrganizationId:
      normalizeZohoNumericId(data?.zohoOrganizationId ?? '')
      || DEFAULT_ZOHO_RV_SETTINGS.zohoOrganizationId,
    zohoSalespersonId:
      normalizeZohoNumericId(data?.zohoSalespersonId ?? '')
      || DEFAULT_ZOHO_RV_SETTINGS.zohoSalespersonId,
    zohoItemIdUpto20Kg:
      normalizeZohoNumericId(data?.zohoItemIdUpto20Kg ?? '')
      || DEFAULT_ZOHO_RV_SETTINGS.zohoItemIdUpto20Kg,
    zohoItemIdAbove20Kg:
      normalizeZohoNumericId(data?.zohoItemIdAbove20Kg ?? '')
      || DEFAULT_ZOHO_RV_SETTINGS.zohoItemIdAbove20Kg,
    zohoModeOfTransport: resolveZohoModeOfTransport(data?.zohoModeOfTransport),
    zohoWalletTransferEnabled: data?.zohoWalletTransferEnabled !== false,
    zohoWalletFromAccountId:
      normalizeZohoNumericId(data?.zohoWalletFromAccountId ?? '')
      || DEFAULT_ZOHO_RV_SETTINGS.zohoWalletFromAccountId,
    zohoWalletToAccountId:
      normalizeZohoNumericId(data?.zohoWalletToAccountId ?? '')
      || DEFAULT_ZOHO_RV_SETTINGS.zohoWalletToAccountId,
    zohoReconcileEnabled: data?.zohoReconcileEnabled !== false,
    zohoRvSettlementEnabled: data?.zohoRvSettlementEnabled !== false,
  };
}

export function isZohoReconcileEnabled(
  settings: Pick<ZohoRvSettings, 'zohoReconcileEnabled'> | null | undefined,
): boolean {
  return settings?.zohoReconcileEnabled !== false;
}

export type ZohoRvSettingsFormValues = ZohoRvSettings;

export function zohoRvSettingsToFormValues(settings: ZohoRvSettings): ZohoRvSettingsFormValues {
  return { ...settings };
}

export function validateZohoRvSettingsForm(values: ZohoRvSettingsFormValues): string | null {
  if (!values.zohoRvInvoicingEnabled) return null;

  const orgId = normalizeZohoNumericId(values.zohoOrganizationId);
  if (orgId.length < 5) return 'Zoho organization ID is required.';

  const salespersonId = normalizeZohoNumericId(values.zohoSalespersonId);
  if (salespersonId.length < 10) return 'Zoho salesperson ID must be at least 10 digits.';

  const itemUpto20 = normalizeZohoNumericId(values.zohoItemIdUpto20Kg);
  if (itemUpto20.length < 10) return 'Zoho item ID (up to 20 kg) must be at least 10 digits.';

  const itemAbove20 = normalizeZohoNumericId(values.zohoItemIdAbove20Kg);
  if (itemAbove20.length < 10) return 'Zoho item ID (above 20 kg) must be at least 10 digits.';

  const mode = resolveZohoModeOfTransport(values.zohoModeOfTransport);
  if (!mode) {
    return 'Mode of transport is required.';
  }
  if (!ZOHO_MODE_OF_TRANSPORT_OPTIONS.includes(mode as ZohoModeOfTransportOption)) {
    return `Mode of transport must match a Zoho dropdown option (e.g. ${ZOHO_MODE_OF_TRANSPORT_OPTIONS.slice(0, 3).join(', ')}).`;
  }

  if (values.zohoWalletTransferEnabled) {
    const fromId = normalizeZohoNumericId(values.zohoWalletFromAccountId);
    const toId = normalizeZohoNumericId(values.zohoWalletToAccountId);
    if (fromId.length < 10) return 'Zoho wallet source account ID (GATC Wallet) is required.';
    if (toId.length < 10) return 'Zoho wallet destination account ID (Kotak) is required.';
    if (fromId === toId) return 'GATC Wallet and Kotak account IDs must differ.';
  }

  return null;
}

export function zohoRvSettingsFromForm(values: ZohoRvSettingsFormValues): ZohoRvSettings {
  return normalizeZohoRvSettings(values);
}
