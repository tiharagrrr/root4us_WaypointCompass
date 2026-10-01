import { canAddTrip } from '../time/budget';
import { defineRule, violation } from './types';

export const TRIP_LIMIT = defineRule('TRIP_LIMIT', {
  check: ({ vehicle, vehicleTrips, params }) => {
    if (!vehicle || !vehicleTrips) return [];
    // The vehicle is over the limit when it could not have taken its last trip.
    if (canAddTrip(vehicleTrips.slice(0, -1), params).ok) return [];
    return [
      violation('TRIP_LIMIT', {
        vehicleId: vehicle.id,
        actual: vehicleTrips.length,
        limit: params.maxTripsPerVehicle,
        message: `${vehicle.code} has ${vehicleTrips.length} trips; the limit is ${params.maxTripsPerVehicle}`,
      }),
    ];
  },
});
