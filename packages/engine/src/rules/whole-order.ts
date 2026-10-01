import { compareText, stableSort } from '../util/stable-sort';
import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const WHOLE_ORDER = defineRule('WHOLE_ORDER', {
  check: ({ trips, orderById }) => {
    const counts = new Map<string, number>();
    for (const trip of trips) {
      for (const id of trip.orderIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const found: Violation[] = [];
    for (const [id, n] of stableSort([...counts], (a, b) => compareText(a[0], b[0]))) {
      if (n > 1) {
        found.push(
          violation('WHOLE_ORDER', {
            orderId: id,
            actual: n,
            limit: 1,
            message: `${orderById.get(id)?.ref ?? id} is on ${n} trips; an order rides on one trip only`,
          }),
        );
      }
    }
    return found;
  },
});
