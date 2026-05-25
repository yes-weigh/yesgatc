import type { Vehicle } from '../types';

export const VEHICLE_PENDING_MESSAGE =
  'This vehicle has been registered but is not yet approved. Please contact Super Admin.';

/** Legacy vehicles without approvalStatus are treated as approved. */
export function isVehicleApproved(vehicle: Pick<Vehicle, 'approvalStatus'>): boolean {
  if (!vehicle.approvalStatus) return true;
  return vehicle.approvalStatus === 'approved';
}

export function vehicleApprovalLabel(status: Vehicle['approvalStatus']): string {
  if (!status || status === 'approved') return 'Approved';
  return 'Pending approval';
}
