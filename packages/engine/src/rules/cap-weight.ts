import { lte, round } from '../util/lte';
import { defineRule, violation } from './types';

export const CAP_WEIGHT = defineRule('CAP_WEIGHT', {
  check: ({ trip, vehicle }) => {
    if (!trip || !vehicle || lte(trip.weightKg, vehicle.weightCapKg)) return [];
    return [
      violation('CAP_WEIGHT', {
        tripKey: trip.key,
        vehicleId: vehicle.id,
        actual: round(trip.weightKg),
        limit: vehicle.weightCapKg,
        message: `Over weight by ${round(trip.weightKg - vehicle.weightCapKg)} kg`,
      }),
    ];
  },
});
