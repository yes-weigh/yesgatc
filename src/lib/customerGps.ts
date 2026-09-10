export const CUSTOMER_GPS_REQUIRED_MESSAGE =
  'Update GPS. Tap refresh to capture customer location.';

export type CustomerLatLng = {
  lat: number;
  lng: number;
};

export function parseCustomerLatLng(
  latitude: string,
  longitude: string,
): CustomerLatLng | undefined {
  const latStr = latitude.trim();
  const lngStr = longitude.trim();
  if (!latStr || !lngStr) return undefined;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

export function customerGpsRequiredError(
  latitude: string,
  longitude: string,
  requireLocation = true,
): string | null {
  if (!requireLocation) return null;
  if (parseCustomerLatLng(latitude, longitude)) return null;
  return CUSTOMER_GPS_REQUIRED_MESSAGE;
}

export function customerPartyGpsBlockReason(input: {
  verificationType: string;
  verificationSubject: string;
  isNewJob?: boolean;
  latitude?: string;
  longitude?: string;
}): string | null {
  if (input.verificationSubject !== 'customer') return null;
  if (input.verificationType !== 'RV' && input.verificationType !== 'OV') return null;
  if (!input.isNewJob) return null;
  return customerGpsRequiredError(input.latitude ?? '', input.longitude ?? '');
}
