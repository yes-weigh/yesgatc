import type { Customer, CustomerLocation, SiteCalibration } from '../types';
import { normalizeVerificationStatus } from './verificationRequest';

export type CustomerTileStats = {
  verificationCount: number;
  dueCount: number;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function formatCustomerRegion(customer: Customer): string {
  const parts = [customer.district, customer.state].filter(part => part?.trim());
  if (parts.length) return parts.join(', ');
  if (customer.address?.trim()) return customer.address.trim();
  return '—';
}

export function customerDistanceKm(
  customer: Customer,
  from?: CustomerLocation | null,
): number | null {
  if (
    from?.lat == null ||
    from?.lng == null ||
    customer.location?.lat == null ||
    customer.location?.lng == null
  ) {
    return null;
  }
  return haversineKm(from.lat, from.lng, customer.location.lat, customer.location.lng);
}

export function formatCustomerDistance(km: number | null): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function verificationValidUpto(certifiedAt: string): Date {
  const date = new Date(certifiedAt);
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);
  return date;
}

function isDueForReverification(certifiedAt?: string): boolean {
  if (!certifiedAt) return true;
  const validUpto = verificationValidUpto(certifiedAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((validUpto.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays <= 30;
}

export function buildCustomerTileStatsMap(
  customers: Customer[],
  verifications: SiteCalibration[],
): Map<string, CustomerTileStats> {
  const byCustomer = new Map<string, SiteCalibration[]>();
  for (const record of verifications) {
    if (!record.customerId) continue;
    const list = byCustomer.get(record.customerId) ?? [];
    list.push(record);
    byCustomer.set(record.customerId, list);
  }

  const result = new Map<string, CustomerTileStats>();

  for (const customer of customers) {
    const records = byCustomer.get(customer.id) ?? [];
    const verificationCount = records.filter(
      record => normalizeVerificationStatus(record) !== 'draft',
    ).length;

    const latestCertBySerial = new Map<string, string>();
    for (const record of records) {
      const status = normalizeVerificationStatus(record);
      if (status !== 'certified' && !record.certifiedAt) continue;
      const serial = record.serialNumber?.trim().toLowerCase();
      if (!serial) continue;
      const certAt = record.certifiedAt || record.approvedAt || '';
      if (!certAt) continue;
      const prev = latestCertBySerial.get(serial);
      if (!prev || certAt > prev) latestCertBySerial.set(serial, certAt);
    }

    const devices = customer.devices ?? [];
    let dueCount = 0;
    for (const device of devices) {
      const serial = device.serialNumber?.trim().toLowerCase();
      const certAt = serial ? latestCertBySerial.get(serial) : undefined;
      if (isDueForReverification(certAt)) dueCount += 1;
    }

    result.set(customer.id, { verificationCount, dueCount });
  }

  return result;
}
