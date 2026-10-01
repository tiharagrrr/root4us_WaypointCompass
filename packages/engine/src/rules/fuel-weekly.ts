import { lte, round } from '../util/lte';
import { defineRule, violation } from './types';

export const FUEL_WEEKLY = defineRule('FUEL_WEEKLY', {
  enabled: (p) => p.enforceFuel,
  check: ({ vehicle, vehicleTrips, input }) => {
    if (!vehicle || !vehicleTrips) return [];
    // fuelUsedThisWeek excludes this plan's own trips, which are summed here.
    let total = input.fuelUsedThisWeek[vehicle.id] ?? 0;
    for (const trip of vehicleTrips) total += trip.litres;
    if (lte(total, vehicle.weeklyFuelQuotaL)) return [];
    return [
      violation('FUEL_WEEKLY', {
        vehicleId: vehicle.id,
        actual: round(total),
        limit: vehicle.weeklyFuelQuotaL,
        message: `${vehicle.code} would use ${round(total)} of ${vehicle.weeklyFuelQuotaL} L this week`,
      }),
    ];
  },
});
