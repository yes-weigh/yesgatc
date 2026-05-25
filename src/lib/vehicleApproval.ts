import type { Vehicle } from '../types';

/** Deactivated vehicles are hidden from operational use. */
export function isVehicleActive(vehicle: Pick<Vehicle, 'active'>): boolean {
  return vehicle.active !== false;
}

export function isVehicleOperational(vehicle: Pick<Vehicle, 'active'>): boolean {
  return isVehicleActive(vehicle);
}

export function vehicleActiveLabel(active?: boolean): string {
  return isVehicleActive({ active }) ? 'Active' : 'Inactive';
}
