import type { CustomerFormValues } from './customerProfileFields';
import {
  buildInitialSelfDeviceRows,
  type VerificationSessionValues,
} from './siteCalibrationProfileFields';

/** Fixed Interweighing site used when OV Interweigh-only mode is on. */
export const INTERWEIGH_OV_PARTY: CustomerFormValues = {
  name: 'Interweighing PVT LTD',
  phone: '8803333444',
  email: '',
  address: '3F Asian Tower, Vytila Cochin',
  pincode: '682019',
  state: 'Kerala',
  district: 'Ernakulam',
  latitude: '',
  longitude: '',
};

export const OV_INTERWEIGH_ONLY_LABEL = 'OV INTERWEIGH only';

export const OV_INTERWEIGH_ONLY_HINT =
  'Force OV only at Interweighing PVT LTD (Vytila Cochin). RV and other addresses are blocked.';

export function isOvInterweighOnlyEnabled(
  settings: { ovInterweighOnlyEnabled?: boolean } | null | undefined,
): boolean {
  return settings?.ovInterweighOnlyEnabled === true;
}

export function interweighOvPartyForm(): CustomerFormValues {
  return { ...INTERWEIGH_OV_PARTY };
}

export function buildInterweighOvSession(sealIdentification = ''): VerificationSessionValues {
  return {
    verificationType: 'OV',
    verificationSubject: 'customer',
    assignedVctId: '',
    customerId: '',
    customerName: INTERWEIGH_OV_PARTY.name,
    ambientTemperature: '',
    relativeHumidity: '',
    verificationLocation: 'in_premises',
    devices: buildInitialSelfDeviceRows(sealIdentification),
  };
}
