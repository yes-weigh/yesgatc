import type { ProductFileMeta } from './productApprovalUpload';
import { isValidEmail, isValidPhone, isValidPincode, normalizePhone, normalizePincode } from './contactFields';
import type { Customer, CustomerDevice, CustomerLocation } from '../types';

export type CustomerFormValues = {
  name: string;
  phone: string;
  email: string;
  address: string;
  pincode: string;
  state: string;
  district: string;
  latitude: string;
  longitude: string;
};

export type CustomerDeviceFormValues = {
  localId: string;
  serialNumber: string;
  productId: string;
  productName: string;
};

export function createEmptyDeviceRow(): CustomerDeviceFormValues {
  return {
    localId: crypto.randomUUID(),
    serialNumber: '',
    productId: '',
    productName: '',
  };
}

export function isPendingNewCustomerParty(form: CustomerFormValues): boolean {
  return Boolean(form.name.trim() && isValidPhone(form.phone));
}

export function isCustomerPartyReadyToPersist(form: CustomerFormValues): boolean {
  const pin = normalizePincode(form.pincode);
  if (pin && !isValidPincode(pin)) return false;
  if (isValidPincode(pin) && (!form.state.trim() || !form.district.trim())) return false;
  return true;
}

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

export function validateCustomerDevices(devices: CustomerDeviceFormValues[]): string | null {
  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    if (!d.serialNumber.trim()) return `Device ${i + 1}: serial number is required.`;
    if (!d.productId.trim()) return `Device ${i + 1}: select a product from the catalogue.`;
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
): Pick<Customer, 'name' | 'phone' | 'email' | 'address' | 'pincode' | 'state' | 'district'> & {
  location?: CustomerLocation;
} {
  const location = parseCustomerLocation(input);
  const base = {
    name: input.name.trim(),
    phone: normalizePhone(input.phone),
    email: input.email.trim(),
    address: input.address.trim(),
    pincode: input.pincode.trim() ? normalizePincode(input.pincode) : '',
    state: input.state.trim(),
    district: input.district.trim(),
  };
  return location ? { ...base, location } : base;
}

export function shopPhotoFromRecord(record: Customer): ProductFileMeta | null {
  const url = record.shopPhotoUrl || record.customerPhotoUrl;
  if (!url) return null;
  return {
    url,
    path: record.shopPhotoPath || record.customerPhotoPath || '',
    name: record.shopPhotoName || record.customerPhotoName || 'Shop photo',
    contentType: record.shopPhotoContentType || record.customerPhotoContentType || 'image/jpeg',
  };
}

export function shopPhotoFieldsFromMeta(meta: ProductFileMeta | null): Partial<Customer> {
  if (!meta) {
    return {
      shopPhotoUrl: '',
      shopPhotoPath: '',
      shopPhotoName: '',
      shopPhotoContentType: '',
      customerPhotoUrl: '',
      customerPhotoPath: '',
      customerPhotoName: '',
      customerPhotoContentType: '',
    };
  }
  return {
    shopPhotoUrl: meta.url,
    shopPhotoPath: meta.path,
    shopPhotoName: meta.name,
    shopPhotoContentType: meta.contentType,
    customerPhotoUrl: '',
    customerPhotoPath: '',
    customerPhotoName: '',
    customerPhotoContentType: '',
  };
}

/** @deprecated use shopPhotoFromRecord */
export const customerPhotoFromRecord = shopPhotoFromRecord;

/** @deprecated use shopPhotoFieldsFromMeta */
export const customerPhotoFieldsFromMeta = shopPhotoFieldsFromMeta;

export function deviceToFormRow(device: CustomerDevice): CustomerDeviceFormValues {
  return {
    localId: device.id,
    serialNumber: device.serialNumber,
    productId: device.productId || '',
    productName: device.productName,
  };
}

export function devicesFromRecord(record: Customer): CustomerDeviceFormValues[] {
  return (record.devices || []).map(deviceToFormRow);
}

export function buildCustomerDevice(row: CustomerDeviceFormValues): CustomerDevice {
  const device: CustomerDevice = {
    id: row.localId,
    serialNumber: row.serialNumber.trim(),
    productName: row.productName.trim(),
  };
  const productId = row.productId.trim();
  if (productId) device.productId = productId;
  return device;
}

export function customerFormFromRecord(record: Customer): CustomerFormValues {
  return {
    name: record.name || '',
    phone: record.phone || '',
    email: record.email || '',
    address: record.address || '',
    pincode: record.pincode || '',
    state: record.state || '',
    district: record.district || '',
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

export function customerFormMapsUrl(values: CustomerFormValues): string | null {
  const location = parseCustomerLocation(values);
  if (!location) return null;
  return `https://www.google.com/maps?q=${location.lat},${location.lng}`;
}

export function customerDeviceCount(record: Customer): number {
  return record.devices?.length ?? 0;
}
