import { WEEKDAYS } from '@waypoint/shared/business-time';
import type { Violation } from '../types';
import { defineRule, violation } from './types';

/**
 * The plan-level violation for a date the depot does not run. allocate() plans nothing on such a date
 * and reports this, so the message is written once.
 */
export function notAnOperatingDay(date: string): Violation {
  return violation('OPERATING_DAY', { message: `${date} is not an operating day` });
}

export const OPERATING_DAY = defineRule('OPERATING_DAY', {
  check: ({ trips, input, orderById, planDow }) => {
    if (trips.length === 0) return [];
    if (!input.isOperatingDay) return [notAnOperatingDay(input.date)];
    const day = planDow;
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
              message: `${order.ref} is a Style order for ${WEEKDAYS[due] ?? due}, not ${WEEKDAYS[day] ?? day}`,
            }),
          );
        }
      }
    }
    return found;
  },
});
