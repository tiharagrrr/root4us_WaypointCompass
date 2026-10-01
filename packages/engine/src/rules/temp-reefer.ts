import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const TEMP_REEFER = defineRule('TEMP_REEFER', {
  check: ({ trip, vehicle, orderById, params }) => {
    if (!trip || !vehicle) return [];
    const found: Violation[] = [];
    for (const id of trip.orderIds) {
      const order = orderById.get(id);
      if (!order) continue;
      if (order.tempClass === 'CHILLED' && vehicle.temp !== 'REEFER') {
        found.push(
          violation('TEMP_REEFER', {
            tripKey: trip.key,
            vehicleId: vehicle.id,
            orderId: order.id,
            message: `${order.ref} is chilled but ${vehicle.code} is not a reefer`,
          }),
        );
      } else if (!params.reeferCarriesAmbient && order.tempClass === 'AMBIENT' && vehicle.temp === 'REEFER') {
        found.push(
          violation('TEMP_REEFER', {
            tripKey: trip.key,
            vehicleId: vehicle.id,
            orderId: order.id,
            message: `${vehicle.code} is a reefer and carries chilled orders only`,
          }),
        );
      }
    }
    return found;
  },
});
