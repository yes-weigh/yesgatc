import type { CustomerFormValues } from './customerProfileFields.ts';
import { isValidPincode, normalizePincode } from './contactFields.ts';
import {
  parseCustomerLatLng,
  type CustomerLatLng,
} from './customerGps.ts';
import type { FirestoreUserDoc } from '../types.ts';

export const VERIFIER_GPS_REQUIRED_MESSAGE =
  'Update GPS. Tap refresh to capture verifier location.';

export type VerifierLocationValues = {
  address: string;
  pincode: string;
  state: string;
  district: string;
  latitude: string;
  longitude: string;
};

export const EMPTY_VERIFIER_LOCATION: VerifierLocationValues = {
  address: '',
  pincode: '',
  state: '',
  district: '',
  latitude: '',
  longitude: '',
};

export function verifierLocationFromUser(
  doc: Pick<FirestoreUserDoc, 'address' | 'pincode' | 'state' | 'district' | 'location'>,
): VerifierLocationValues {
  return {
    address: doc.address || '',
    pincode: doc.pincode || '',
    state: doc.state || '',
    district: doc.district || '',
    latitude: doc.location?.lat != null ? String(doc.location.lat) : '',
    longitude: doc.location?.lng != null ? String(doc.location.lng) : '',
  };
}

export function verifierPartyFormValues(
  username: string,
  phone: string,
  email: string,
  location: VerifierLocationValues,
): CustomerFormValues {
  return {
    name: username,
    phone,
    email,
    address: location.address,
    pincode: location.pincode,
    state: location.state,
    district: location.district,
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

export function parseVerifierLatLng(location: VerifierLocationValues): CustomerLatLng | undefined {
  return parseCustomerLatLng(location.latitude, location.longitude);
}

export function validateVerifierLocation(location: VerifierLocationValues): string | null {
  if (!location.address.trim()) return 'Address is required.';
  if (!isValidPincode(location.pincode)) return 'Postal code must be exactly 6 digits.';
  if (!location.state.trim() || !location.district.trim()) {
    return 'Complete postal code and wait for district and state.';
  }
  if (!parseVerifierLatLng(location)) return VERIFIER_GPS_REQUIRED_MESSAGE;
  return null;
}

export function verifierLocationPersistFields(location: VerifierLocationValues): Pick<
  FirestoreUserDoc,
  'address' | 'pincode' | 'state' | 'district' | 'location'
> {
  const pin = location.pincode.trim() ? normalizePincode(location.pincode) : '';
  const parsed = parseVerifierLatLng(location);
  return {
    address: location.address.trim(),
    pincode: pin,
    state: location.state.trim(),
    district: location.district.trim(),
    location: parsed ?? { lat: 0, lng: 0 },
  };
}

/** Own-doc GPS write — lat/lng only. Rules reject any other user-field change. */
export function verifierOwnGpsWrite(lat: number, lng: number): { location: CustomerLatLng } | null {
  const parsed = parseCustomerLatLng(String(lat), String(lng));
  return parsed ? { location: parsed } : null;
}
