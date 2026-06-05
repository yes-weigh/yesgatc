import {
  applyLaboratorySealToDeviceRows,
} from './rcLaboratoryFields';
import {
  buildInitialSelfDeviceRows,
  deviceRowsFromCustomer,
  EMPTY_VERIFICATION_SESSION,
  type VerificationSessionValues,
} from './siteCalibrationProfileFields';
import type { Customer, Product } from '../types';

export function verificationUrlForCustomer(customerId: string, appBasePath: '/rc' | '/vct'): string {
  return `${appBasePath}/verification?customerId=${encodeURIComponent(customerId)}`;
}

export function resolveAppBasePath(pathname: string): '/rc' | '/vct' {
  return pathname.startsWith('/vct') ? '/vct' : '/rc';
}

export function buildCustomerVerificationSession(
  customer: Customer,
  products: Product[],
  laboratorySealId = '',
): VerificationSessionValues {
  const registeredRows = applyLaboratorySealToDeviceRows(
    deviceRowsFromCustomer(customer, products),
    laboratorySealId,
  );
  const devices =
    registeredRows.length > 0
      ? registeredRows
      : applyLaboratorySealToDeviceRows(buildInitialSelfDeviceRows(laboratorySealId), laboratorySealId);

  return {
    ...EMPTY_VERIFICATION_SESSION,
    verificationType: 'OV',
    verificationSubject: 'customer',
    customerId: customer.id,
    customerName: customer.name,
    devices,
  };
}
