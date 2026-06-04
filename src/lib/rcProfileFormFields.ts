import type { CustomerFormValues } from './customerProfileFields';
import { parseRcLocation } from './rcProfileFields';
import type { CustomerLocation, FirestoreUserDoc } from '../types';

export function rcProfileToFormValues(
  rc: Pick<
    FirestoreUserDoc,
    'companyName' | 'username' | 'phone' | 'email' | 'address' | 'pincode' | 'place' | 'location'
  >,
): CustomerFormValues {
  return {
    name: rc.companyName?.trim() || rc.username?.trim() || '',
    phone: rc.phone || '',
    email: rc.email || '',
    address: rc.address || '',
    pincode: rc.pincode || '',
    state: '',
    district: rc.place || '',
    latitude: rc.location?.lat != null ? String(rc.location.lat) : '',
    longitude: rc.location?.lng != null ? String(rc.location.lng) : '',
  };
}

export function rcProfilePatchFromFormValues(
  values: CustomerFormValues,
): Pick<FirestoreUserDoc, 'companyName' | 'phone' | 'email' | 'address' | 'pincode' | 'place'> & {
  location?: CustomerLocation;
} {
  const base = {
    companyName: values.name.trim(),
    phone: values.phone.trim(),
    email: values.email.trim(),
    address: values.address.trim(),
    pincode: values.pincode.trim(),
    place: values.district.trim(),
  };
  const location = parseRcLocation(values);
  return location ? { ...base, location } : base;
}
