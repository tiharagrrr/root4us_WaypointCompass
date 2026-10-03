import { preparePlan } from '../plan/prepare';
import { budgetUse } from '../time/budget';
import type { EngineInput, Plan } from '../types';
import { round } from '../util/lte';
import { compareText, stableSort } from '../util/stable-sort';

export type VehicleStatus = 'AVAILABLE' | 'NO_TRIPS_LEFT' | 'WORKSHOP' | 'BREAKDOWN' | 'UNAVAILABLE';

export interface VehicleOption {
  vehicleId: string;
  code: string;
  /** Why the vehicle can or cannot take a trip. An unavailable vehicle shows why, not "no trips". */
  status: VehicleStatus;
  available: boolean;
  unavailableReason: 'WORKSHOP' | 'BREAKDOWN' | null;
  tripsUsed: number;
  tripsLeft: number;
  /** The smallest free trip number, or null when none is left. */
  nextTripNo: number | null;
  freshMinutesLeft: number;
  styleTechMinutesLeft: number;
  weightCapKg: number;
  volumeCapM3: number;
  /** Weekly quota, less what is used this week and what the plan's trips need. */
  fuelLeftL: number;
}

/**
 * Every vehicle with what it has left, for screen 06, sorted by code. Fixed trips (released or in
 * progress) count with the plan's. A vehicle in the workshop or broken down shows that, and a
 * vehicle with all its trips used shows none left.
 */
export function vehicleOptions(input: EngineInput, plan: Plan): VehicleOption[] {
  const { params, trips } = preparePlan(input, plan);
  return stableSort(input.vehicles, (a, b) => compareText(a.code, b.code) || compareText(a.id, b.id)).map((vehicle) => {
    const own = trips.filter((t) => t.vehicleId === vehicle.id);
    const used = budgetUse(own);
    const litres = own.reduce((sum, t) => sum + t.litres, 0);
    const taken = new Set(own.map((t) => t.tripNo));
    let nextTripNo: number | null = null;
    for (let n = 1; n <= params.maxTripsPerVehicle && nextTripNo === null; n++) if (!taken.has(n)) nextTripNo = n;
    const tripsLeft = Math.max(0, params.maxTripsPerVehicle - own.length);

    let status: VehicleStatus = 'AVAILABLE';
    if (!vehicle.available) status = vehicle.unavailableReason ?? 'UNAVAILABLE';
    else if (tripsLeft === 0) status = 'NO_TRIPS_LEFT';

    return {
      vehicleId: vehicle.id,
      code: vehicle.code,
      status,
      available: vehicle.available,
      unavailableReason: vehicle.unavailableReason,
      tripsUsed: own.length,
      tripsLeft,
      nextTripNo,
      freshMinutesLeft: round(params.freshBudgetMin - used.freshMinutes),
      styleTechMinutesLeft: round(params.styleTechBudgetMin - used.styleTechMinutes),
      weightCapKg: vehicle.weightCapKg,
      volumeCapM3: vehicle.volumeCapM3,
      fuelLeftL: round(vehicle.weeklyFuelQuotaL - (input.fuelUsedThisWeek[vehicle.id] ?? 0) - litres),
    };
  });
}
