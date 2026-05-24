import type { ProductFileMeta } from './productApprovalUpload';
import { isValidEmail, isValidPhone, isValidPincode, normalizePhone, normalizePincode } from './contactFields';
import type { Customer, CustomerLocation } from '../types';

export type CustomerFormValues = {
  name: string;
  phone: string;
  email: string;
  address: string;
  pincode: string;
  latitude: string;
  longitude: string;
};

export function validateCustomerProfile(input: CustomerFormValues): string | null {
  if (!input.name.trim()) return 'Customer name is required.';
  if (!isValidPhone(input.phone)) return 'Mobile number must be exactly 10 digits.';
  if (input.email.trim() && !isValidEmail(input.email)) return 'Enter a valid email address.';
  if (!input.address.trim()) return 'Address is required.';
  if (input.pincode.trim() && !isValidPincode(input.pincode)) {
    return 'Postal code must be exactly 6 digits.';
  }

  const latStr = input.latitude.trim();
  const lngStr = input.longitude.trim();
  if (latStr || lngStr) {
    if (!latStr || !lngStr) return 'Enter both latitude and longitude, or leave both empty.';
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return 'Latitude must be between -90 and 90.';
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return 'Longitude must be between -180 and 180.';
    }
  }
  return null;
}

export function parseCustomerLocation(input: CustomerFormValues): CustomerLocation | undefined {
  const latStr = input.latitude.trim();
  const lngStr = input.longitude.trim();
  if (!latStr || !lngStr) return undefined;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

export function buildCustomerProfileFields(
  input: CustomerFormValues,
): Pick<Customer, 'name' | 'phone' | 'email' | 'address' | 'pincode'> & { location?: CustomerLocation } {
  const location = parseCustomerLocation(input);
  const base = {
    name: input.name.trim(),
    phone: normalizePhone(input.phone),
    email: input.email.trim() || undefined,
    address: input.address.trim(),
    pincode: input.pincode.trim() ? normalizePincode(input.pincode) : undefined,
  };
  return location ? { ...base, location } : base;
}

export function customerPhotoFromRecord(record: Customer): ProductFileMeta | null {
  if (!record.customerPhotoUrl) return null;
  return {
    url: record.customerPhotoUrl,
    path: record.customerPhotoPath || '',
    name: record.customerPhotoName || 'Customer photo',
    contentType: record.customerPhotoContentType || 'image/jpeg',
  };
}

export function customerPhotoFieldsFromMeta(meta: ProductFileMeta | null): Partial<Customer> {
  if (!meta) {
    return {
      customerPhotoUrl: '',
      customerPhotoPath: '',
      customerPhotoName: '',
      customerPhotoContentType: '',
    };
  }
  return {
    customerPhotoUrl: meta.url,
    customerPhotoPath: meta.path,
    customerPhotoName: meta.name,
    customerPhotoContentType: meta.contentType,
  };
}

export function customerFormFromRecord(record: Customer): CustomerFormValues {
  return {
    name: record.name || '',
    phone: record.phone || '',
    email: record.email || '',
    address: record.address || '',
    pincode: record.pincode || '',
    latitude: record.location?.lat != null ? String(record.location.lat) : '',
    longitude: record.location?.lng != null ? String(record.location.lng) : '',
  };
}

export function formatCustomerLocation(record: Customer): string {
  if (!record.location) return '—';
  return `${record.location.lat.toFixed(5)}, ${record.location.lng.toFixed(5)}`;
}

export function customerMapsUrl(record: Customer): string | null {
  if (!record.location) return null;
  return `https://www.google.com/maps?q=${record.location.lat},${record.location.lng}`;
}
