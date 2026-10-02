import type { Brand } from '@waypoint/shared/domain';
import type { EngineParams } from '../params';

export interface VehicleTrip {
  brand: Brand;
  minutes: number;
}

export interface BudgetUse {
  freshMinutes: number;
  styleTechMinutes: number;
}

/** Fresh trips count against one budget; Style and Tech trips share another. */
export function budgetUse(trips: readonly VehicleTrip[]): BudgetUse {
  let freshMinutes = 0;
  let styleTechMinutes = 0;
  for (const trip of trips) {
    if (trip.brand === 'FRESH') freshMinutes += trip.minutes;
    else styleTechMinutes += trip.minutes;
  }
  return { freshMinutes, styleTechMinutes };
}

export type CanAddTrip = { ok: true } | { ok: false; refusedBy: 'TRIP_LIMIT' };

/**
 * Whether a vehicle may take one more trip today. Refused at the limit whatever minutes remain;
 * `existing` includes fixed and reserved trips. The TRIP_LIMIT rule calls this.
 */
export function canAddTrip(
  existing: readonly VehicleTrip[],
  params: Pick<EngineParams, 'maxTripsPerVehicle'>,
): CanAddTrip {
  return existing.length < params.maxTripsPerVehicle
    ? { ok: true }
    : { ok: false, refusedBy: 'TRIP_LIMIT' };
}
