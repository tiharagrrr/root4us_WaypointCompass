import { scheduleOf } from '../plan/trip-schedule';
import { formatMinutes } from '../util/time-format';
import { lte } from '../util/lte';
import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const WINDOW_OUTLET = defineRule('WINDOW_OUTLET', {
  enabled: (p) => p.enforceWindows,
  check: (ctx) => {
    const { trip } = ctx;
    if (!trip) return [];
    const { schedule, stops } = scheduleOf(ctx, trip);
    const found: Violation[] = [];
    stops.forEach((stop, i) => {
      const s = schedule.stops[i];
      if (!s) return;
      const { windowOpenMin: open, windowCloseMin: close } = stop.outlet;
      if (lte(open, s.startMin) && lte(s.finishMin, close)) return;
      found.push(
        violation('WINDOW_OUTLET', {
          tripKey: trip.key,
          orderId: stop.order.id,
          actual: s.finishMin,
          limit: close,
          message: `${stop.order.ref} is served ${formatMinutes(s.startMin)} to ${formatMinutes(s.finishMin)}, outside its window ${formatMinutes(open)} to ${formatMinutes(close)}`,
        }),
      );
    });
    return found;
  },
});
