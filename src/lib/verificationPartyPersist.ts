import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Customer } from '../types';
import { isValidPincode, normalizePincode } from './contactFields';
import {
  buildCustomerProfileFields,
  validateCustomerProfile,
  type CustomerFormValues,
} from './customerProfileFields';
import { rcProfilePatchFromFormValues } from './rcProfileFormFields';

export function isPartyFormReadyToPersist(form: CustomerFormValues): boolean {
  const pin = normalizePincode(form.pincode);
  if (pin && !isValidPincode(pin)) return false;
  if (isValidPincode(pin) && (!form.state.trim() || !form.district.trim())) return false;
  return true;
}

export type PersistVerificationPartyParams = {
  isSelf: boolean;
  customerId: string;
  customerForm: CustomerFormValues;
  rcForm: CustomerFormValues;
  rcUid?: string;
};

export type PersistVerificationPartyResult = {
  error: string | null;
  updatedCustomer?: Customer;
  rcProfileSaved?: boolean;
};

export async function persistVerificationPartyProfile(
  params: PersistVerificationPartyParams,
  existingCustomers: Customer[],
): Promise<PersistVerificationPartyResult> {
  const { isSelf, customerId, customerForm, rcForm, rcUid } = params;

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
      await updateDoc(doc(db, 'users', rcUid), rcProfilePatchFromFormValues(rcForm));
      return { error: null, rcProfileSaved: true };
    } catch (err: unknown) {
      return {
        error: err instanceof Error ? err.message : 'Failed to save RC profile.',
      };
    }
  }

  if (!customerId.trim()) return { error: null };

  if (!customerForm.name.trim() || !customerForm.phone.trim()) return { error: null };
  if (!isPartyFormReadyToPersist(customerForm)) {
    return {
      error: 'Complete postal code and wait for district and state before saving.',
    };
  }
  const validationError = validateCustomerProfile(customerForm);
  if (validationError) return { error: validationError };

  try {
    const profile = buildCustomerProfileFields(customerForm);
    const updatedAt = new Date().toISOString();
    await updateDoc(doc(db, 'customers', customerId), {
      ...profile,
      updatedAt,
    });
    const existing = existingCustomers.find(c => c.id === customerId);
    return {
      error: null,
      updatedCustomer: existing ? { ...existing, ...profile, updatedAt } : undefined,
    };
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err.message : 'Failed to save customer.',
    };
  }
}
