import { scheduleOf } from '../plan/trip-schedule';
import { minuteLabel } from '@waypoint/shared/business-time';
import { lte } from '../util/lte';
import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const WINDOW_MALL = defineRule('WINDOW_MALL', {
  enabled: (p) => p.enforceWindows,
  check: (ctx) => {
    const { trip } = ctx;
    if (!trip) return [];
    const { schedule, stops } = scheduleOf(ctx, trip);
    const found: Violation[] = [];
    stops.forEach((stop, i) => {
      const s = schedule.stops[i];
      const { parkingConstraint, mallWindowOpenMin: open, mallWindowCloseMin: close } = stop.outlet;
      if (!s || parkingConstraint !== 'MALL_DOCK' || open === null || close === null) return;
      if (lte(open, s.startMin) && lte(s.finishMin, close)) return;
      found.push(
        violation('WINDOW_MALL', {
          tripKey: trip.key,
          orderId: stop.order.id,
          actual: s.finishMin,
          limit: close,
          message: `${stop.order.ref} is served ${minuteLabel(s.startMin)} to ${minuteLabel(s.finishMin)}, outside the mall window ${minuteLabel(open)} to ${minuteLabel(close)}`,
        }),
      );
    });
    return found;
  },
});
