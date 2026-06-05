import { normalizePhone } from './contactFields';
import type { Customer } from '../types';

function customerMatchesSearch(customer: Customer, query: string): boolean {
  const nameQuery = query.trim().toLowerCase();
  const phoneQuery = normalizePhone(query);

  if (phoneQuery.length >= 3 && normalizePhone(customer.phone).includes(phoneQuery)) {
    return true;
  }
  if (nameQuery.length >= 1 && customer.name.toLowerCase().includes(nameQuery)) {
    return true;
  }
  return false;
}

export function filterCustomersBySearch(customers: Customer[], query: string): Customer[] {
  const trimmed = query.trim();
  if (!trimmed) return customers;
  return customers.filter(customer => customerMatchesSearch(customer, trimmed));
}

export function filterCustomersForLookup(customers: Customer[], query: string, limit = 12): Customer[] {
  const trimmed = query.trim();
  const phoneQuery = normalizePhone(query);

  if (!trimmed && phoneQuery.length < 3) {
    return customers.slice(0, limit);
  }

  return customers
    .filter(customer => customerMatchesSearch(customer, trimmed))
    .slice(0, limit);
}

export function formatPhoneDisplay(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length !== 10) return phone.trim();
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
