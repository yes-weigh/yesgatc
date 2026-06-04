import { collection, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Customer } from '../types';
import { normalizePhone } from './contactFields';
import {
  buildCustomerProfileFields,
  isCustomerPartyReadyToPersist,
  parseCustomerLocation,
  validateCustomerProfile,
  type CustomerFormValues,
} from './customerProfileFields';
import { parseRcLocation } from './rcProfileFields';
import { rcProfilePatchFromFormValues } from './rcProfileFormFields';

export function isPartyFormReadyToPersist(form: CustomerFormValues): boolean {
  return isCustomerPartyReadyToPersist(form);
}

export type PersistVerificationPartyParams = {
  isSelf: boolean;
  customerId: string;
  customerForm: CustomerFormValues;
  rcForm: CustomerFormValues;
  rcUid?: string;
  rcId?: string;
  createdByUid?: string;
};

export type PersistVerificationPartyResult = {
  error: string | null;
  createdCustomer?: Customer;
  updatedCustomer?: Customer;
  rcProfileSaved?: boolean;
};

function findCustomerByPhone(customers: Customer[], phone: string): Customer | undefined {
  const normalized = normalizePhone(phone);
  if (!normalized) return undefined;
  return customers.find(c => normalizePhone(c.phone) === normalized);
}

async function saveExistingCustomerProfile(
  customerId: string,
  customerForm: CustomerFormValues,
  existingCustomers: Customer[],
): Promise<PersistVerificationPartyResult> {
  const profile = buildCustomerProfileFields(customerForm);
  const updatedAt = new Date().toISOString();
  const updates: Record<string, unknown> = {
    ...profile,
    updatedAt,
  };
  if (!parseCustomerLocation(customerForm)) {
    updates.location = deleteField();
  }
  await updateDoc(doc(db, 'customers', customerId), updates);
  const existing = existingCustomers.find(c => c.id === customerId);
  return {
    error: null,
    updatedCustomer: {
      id: customerId,
      rcId: existing?.rcId ?? '',
      createdAt: existing?.createdAt ?? updatedAt,
      devices: existing?.devices ?? [],
      ...existing,
      ...profile,
      updatedAt,
    },
  };
}

export async function persistVerificationPartyProfile(
  params: PersistVerificationPartyParams,
  existingCustomers: Customer[],
): Promise<PersistVerificationPartyResult> {
  const { isSelf, customerId, customerForm, rcForm, rcUid, rcId, createdByUid } = params;

  if (isSelf) {
    if (!rcUid || !rcForm.name.trim()) return { error: null };
    if (!isPartyFormReadyToPersist(rcForm)) {
      return {
        error: 'Complete postal code and wait for district and state before saving.',
      };
    }
    const validationError = validateCustomerProfile(rcForm);
    if (validationError) return { error: validationError };
    try {
      const patch = rcProfilePatchFromFormValues(rcForm);
      const updates: Record<string, unknown> = { ...patch };
      if (!parseRcLocation(rcForm)) {
        updates.location = deleteField();
      }
      await updateDoc(doc(db, 'users', rcUid), updates);
      return { error: null, rcProfileSaved: true };
    } catch (err: unknown) {
      return {
        error: err instanceof Error ? err.message : 'Failed to save RC profile.',
      };
    }
  }

  if (!customerForm.name.trim() || !customerForm.phone.trim()) return { error: null };
  if (!isPartyFormReadyToPersist(customerForm)) {
    return {
      error: 'Complete postal code and wait for district and state before saving.',
    };
  }
  const validationError = validateCustomerProfile(customerForm);
  if (validationError) return { error: validationError };

  try {
    if (customerId.trim()) {
      return saveExistingCustomerProfile(customerId, customerForm, existingCustomers);
    }

    const existingByPhone = findCustomerByPhone(existingCustomers, customerForm.phone);
    if (existingByPhone) {
      return saveExistingCustomerProfile(existingByPhone.id, customerForm, existingCustomers);
    }

    if (!rcId) {
      return { error: 'RC account is required to create a customer.' };
    }

    const profile = buildCustomerProfileFields(customerForm);
    const createdAt = new Date().toISOString();
    const ref = doc(collection(db, 'customers'));
    const record: Omit<Customer, 'id'> = {
      rcId,
      createdAt,
      createdByUid,
      devices: [],
      ...profile,
    };
    await setDoc(ref, record);
    return {
      error: null,
      createdCustomer: { id: ref.id, ...record },
    };
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : 'Failed to save customer.',
    };
  }
}
