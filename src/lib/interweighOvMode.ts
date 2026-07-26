import type { CustomerFormValues } from './customerProfileFields';
import {
  buildInitialSelfDeviceRows,
  type VerificationSessionValues,
} from './siteCalibrationProfileFields';

export type InterweighGpsCoords = {
  lat: number;
  lng: number;
};

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

export const OV_INTERWEIGH_GPS_REQUIRED_MESSAGE =
  'Interweigh GPS required. Super Admin must set latitude and longitude on Integrations.';

export function isOvInterweighOnlyEnabled(
  settings: { ovInterweighOnlyEnabled?: boolean } | null | undefined,
): boolean {
  return settings?.ovInterweighOnlyEnabled === true;
}

export function getOvInterweighGpsCoords(
  settings:
    | {
        ovInterweighLatitude?: number | null;
        ovInterweighLongitude?: number | null;
      }
    | null
    | undefined,
): InterweighGpsCoords | null {
  const lat = settings?.ovInterweighLatitude;
  const lng = settings?.ovInterweighLongitude;
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function interweighOvPartyForm(
  coords?: InterweighGpsCoords | null,
): CustomerFormValues {
  return {
    ...INTERWEIGH_OV_PARTY,
    latitude: coords ? String(coords.lat) : '',
    longitude: coords ? String(coords.lng) : '',
  };
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
    verificationLocation: 'in_situ',
    devices: buildInitialSelfDeviceRows(sealIdentification),
  };
}
