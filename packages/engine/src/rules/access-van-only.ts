import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const ACCESS_VAN_ONLY = defineRule('ACCESS_VAN_ONLY', {
  check: ({ trip, vehicle, orderById, input }) => {
    if (!trip || !vehicle || vehicle.type === 'VAN') return [];
    const found: Violation[] = [];
    for (const id of trip.orderIds) {
      const order = orderById.get(id);
      const outlet = order ? input.outlets[order.outletId] : undefined;
      if (order && outlet?.parkingConstraint === 'VAN_ONLY') {
        found.push(
          violation('ACCESS_VAN_ONLY', {
            tripKey: trip.key,
            vehicleId: vehicle.id,
            orderId: order.id,
            message: `${order.ref} needs a van; ${vehicle.code} is a truck`,
          }),
        );
      }
    }
    return found;
  },
});
