import { defineRule, violation } from './types';

export const VEHICLE_AVAILABLE = defineRule('VEHICLE_AVAILABLE', {
  check: ({ vehicle }) => {
    if (!vehicle || vehicle.available) return [];
    return [
      violation('VEHICLE_AVAILABLE', {
        vehicleId: vehicle.id,
        message: `${vehicle.code} is not available (${vehicle.unavailableReason ?? 'unavailable'})`,
      }),
    ];
  },
});
