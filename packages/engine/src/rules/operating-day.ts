import { DAY_NAMES, weekdayOf } from '../util/date';
import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const OPERATING_DAY = defineRule('OPERATING_DAY', {
  check: ({ trips, input, orderById }) => {
    if (trips.length === 0) return [];
    if (!input.isOperatingDay) {
      return [violation('OPERATING_DAY', { message: `${input.date} is not an operating day` })];
    }
    const day = weekdayOf(input.date);
    const found: Violation[] = [];
    for (const trip of trips) {
      for (const id of trip.orderIds) {
        const order = orderById.get(id);
        const due = order ? input.outlets[order.outletId]?.styleDeliveryDow : null;
        if (order?.brand === 'STYLE' && due !== null && due !== undefined && due !== day) {
          found.push(
            violation('OPERATING_DAY', {
              tripKey: trip.key,
              orderId: order.id,
              message: `${order.ref} is a Style order for ${DAY_NAMES[due] ?? due}, not ${DAY_NAMES[day] ?? day}`,
            }),
          );
        }
      }
    }
    return found;
  },
});
