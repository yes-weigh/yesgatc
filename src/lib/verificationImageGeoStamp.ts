import { CUSTOMER_GPS_REQUIRED_MESSAGE } from './customerGps.ts';

export type GeoStampCoordinates = {
  lat: number;
  lng: number;
};

export { CUSTOMER_GPS_REQUIRED_MESSAGE };
/** @deprecated Use CUSTOMER_GPS_REQUIRED_MESSAGE */
export const RV_CUSTOMER_GPS_REQUIRED_MESSAGE = CUSTOMER_GPS_REQUIRED_MESSAGE;

export function isCustomerImageGpsJob(
  verificationType: string,
  verificationSubject: string,
): boolean {
  return (
    (verificationType === 'RV' || verificationType === 'OV')
    && verificationSubject === 'customer'
  );
}

/** @deprecated Use isCustomerImageGpsJob */
export function isRvCustomerImageGpsJob(
  verificationType: string,
  verificationSubject: string,
): boolean {
  return isCustomerImageGpsJob(verificationType, verificationSubject);
}

export function geoStampCoordsFromLocation(
  location?: { lat: number; lng: number } | null,
): GeoStampCoordinates | null {
  if (location == null) return null;
  const { lat, lng } = location;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * RV / OV customer jobs stamp the customer record/form GPS — never RC centre coords.
 * OV Self keeps RC centre GPS.
 */
export function resolveVerificationImageGeoStampCoords(input: {
  verificationType: string;
  verificationSubject: string;
  customerLocation?: { lat: number; lng: number } | null;
  rcLocation?: { lat: number; lng: number } | null;
}): GeoStampCoordinates | null {
  if (isCustomerImageGpsJob(input.verificationType, input.verificationSubject)) {
    return geoStampCoordsFromLocation(input.customerLocation);
  }
  return geoStampCoordsFromLocation(input.rcLocation);
}

/** Live device / last-known GPS only for OV Self. Customer jobs never fall back to RC/device GPS. */
export function allowsLiveGpsPhotoStamp(
  verificationType: string,
  verificationSubject: string,
): boolean {
  return !isCustomerImageGpsJob(verificationType, verificationSubject);
}

export type PhotoStampCoordSource = 'forced' | 'live' | 'none';

export function resolvePhotoStampCoordSource(input: {
  forcedCoords?: { lat: number; lng: number } | null;
  allowLiveGps?: boolean;
}): PhotoStampCoordSource {
  if (input.forcedCoords != null) return 'forced';
  if (input.allowLiveGps !== false) return 'live';
  return 'none';
}
