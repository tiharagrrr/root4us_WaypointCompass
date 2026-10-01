import { lte, round } from '../util/lte';
import { defineRule, violation } from './types';

export const CAP_VOLUME = defineRule('CAP_VOLUME', {
  check: ({ trip, vehicle }) => {
    if (!trip || !vehicle || lte(trip.volumeM3, vehicle.volumeCapM3)) return [];
    return [
      violation('CAP_VOLUME', {
        tripKey: trip.key,
        vehicleId: vehicle.id,
        actual: round(trip.volumeM3),
        limit: vehicle.volumeCapM3,
        message: `Over volume by ${round(trip.volumeM3 - vehicle.volumeCapM3)} m³`,
      }),
    ];
  },
});
