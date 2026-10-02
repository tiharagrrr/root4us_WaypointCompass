import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const TRIP_BRAND_DISTRICT = defineRule('TRIP_BRAND_DISTRICT', {
  check: ({ trip, orderById }) => {
    if (!trip) return [];
    const found: Violation[] = [];
    for (const id of trip.orderIds) {
      const order = orderById.get(id);
      if (order && (order.brand !== trip.brand || order.districtId !== trip.districtId)) {
        found.push(
          violation('TRIP_BRAND_DISTRICT', {
            tripKey: trip.key,
            orderId: order.id,
            message: `A trip serves one brand and district (${trip.brand}, ${trip.districtId}); ${order.ref} is ${order.brand}, ${order.districtId}`,
          }),
        );
      }
    }
    return found;
  },
});
