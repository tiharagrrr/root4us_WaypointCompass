import { scheduleOf } from '../plan/trip-schedule';
import { lte, round } from '../util/lte';
import type { Violation } from '../types';
import { defineRule, violation } from './types';

export const LATE_RISK = defineRule('LATE_RISK', {
  enabled: (p) => p.enforceWindows,
  check: (ctx) => {
    const { trip, params } = ctx;
    if (!trip) return [];
    const { schedule, stops } = scheduleOf(ctx, trip);
    const found: Violation[] = [];
    stops.forEach((stop, i) => {
      const s = schedule.stops[i];
      if (!s) return;
      const slack = stop.effectiveCloseMin - s.finishMin;
      if (lte(params.lateRiskSlackMin, slack)) return;
      found.push(
        violation('LATE_RISK', {
          tripKey: trip.key,
          orderId: stop.order.id,
          actual: round(slack),
          limit: params.lateRiskSlackMin,
          message: `${stop.order.ref} has ${round(slack)} min of window slack, under ${params.lateRiskSlackMin}`,
        }),
      );
    });
    return found;
  },
});
