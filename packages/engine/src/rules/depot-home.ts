import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const DEPOT_HOME = defineRule('DEPOT_HOME', {
  check: ({ trip, vehicle, orderById, input }) => {
    if (!trip || !vehicle) return [];
    const found: Violation[] = [];
    for (const id of trip.orderIds) {
      const order = orderById.get(id);
      const outlet = order ? input.outlets[order.outletId] : undefined;
      if (order && outlet && outlet.depotId !== vehicle.depotId) {
        found.push(
          violation('DEPOT_HOME', {
            tripKey: trip.key,
            vehicleId: vehicle.id,
            orderId: order.id,
            message: `${order.ref} belongs to ${outlet.depotId}; ${vehicle.code} is based at ${vehicle.depotId}`,
          }),
        );
      }
    }
    return found;
  },
});
