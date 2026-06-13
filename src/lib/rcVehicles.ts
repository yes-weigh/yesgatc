import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Vehicle } from '../types';

export async function fetchRcVehicles(rcId: string): Promise<Vehicle[]> {
  if (!rcId.trim()) return [];
  const snap = await getDocs(query(collection(db, 'vehicles'), where('rcId', '==', rcId)));
  return snap.docs.map(docSnap => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<Vehicle, 'id'>),
  }));
}

export function rcHasRegisteredVehicle(vehicles: Vehicle[]): boolean {
  return vehicles.length > 0;
}

export const VCT_RC_VEHICLE_REQUIRED_MESSAGE =
  'Your regional centre has not registered a vehicle yet. Ask your RC admin to add one before starting new verifications.';
