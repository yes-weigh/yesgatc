export type ZohoRvSettings = {
  /** When true, RV submit requires RC zohoId and triggers Zoho invoice on submit. */
  zohoRvInvoicingEnabled: boolean;
  zohoOrganizationId: string;
  zohoSalespersonId: string;
  zohoItemIdUpto20Kg: string;
  zohoItemIdAbove20Kg: string;
  zohoModeOfTransport: string;
};

export const DEFAULT_ZOHO_RV_SETTINGS: ZohoRvSettings = {
  zohoRvInvoicingEnabled: true,
  zohoOrganizationId: '60001225303',
  zohoSalespersonId: '99381000030360028',
  zohoItemIdUpto20Kg: '99381000030360012',
  zohoItemIdAbove20Kg: '99381000030360017',
  zohoModeOfTransport: 'Without Machine',
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
    zohoModeOfTransport:
      data?.zohoModeOfTransport?.trim() || DEFAULT_ZOHO_RV_SETTINGS.zohoModeOfTransport,
  };
}

export type ZohoRvSettingsFormValues = {
  zohoRvInvoicingEnabled: boolean;
  zohoOrganizationId: string;
  zohoSalespersonId: string;
  zohoItemIdUpto20Kg: string;
  zohoItemIdAbove20Kg: string;
  zohoModeOfTransport: string;
};

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

  if (!values.zohoModeOfTransport.trim()) {
    return 'Mode of transport is required.';
  }

  return null;
}

export function zohoRvSettingsFromForm(values: ZohoRvSettingsFormValues): ZohoRvSettings {
  return normalizeZohoRvSettings(values);
}
