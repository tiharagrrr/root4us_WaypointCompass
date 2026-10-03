import type { EngineInput, Plan, RuleContext, Trip } from '../types';
import { compareText, stableSort } from '../util/stable-sort';
import { preparePlan } from './prepare';
import { scheduleOf } from './trip-schedule';

/** One stop as the schedule reaches it. Minutes after midnight, Asia/Colombo. */
export interface ScheduledStopOf {
  orderId: string;
  /** The leg into this stop: depot to district for the first, inter-stop for the rest. */
  travelMin: number;
  arriveMin: number;
  startMin: number;
  finishMin: number;
  serviceMin: number;
  /** The effective window: the outlet's, narrowed by the mall's at a mall dock. */
  windowOpenMin: number;
  windowCloseMin: number;
}

/** A plan trip, measured and scheduled. */
export interface ScheduledTrip extends Trip {
  departMin: number;
  returnMin: number;
  stops: ScheduledStopOf[];
}

/**
 * Every trip of the plan measured and timed, stop by stop, exactly as the rules see it: what the API
 * stores on trips and stops (planned departure, arrival, travel and service minutes, the window
 * snapshot). Fixed trips are left out; they are already stored. Sorted by trip key.
 */
export function planSchedule(input: EngineInput, plan: Plan): ScheduledTrip[] {
  const { params, dow, lookups, trips } = preparePlan(input, plan);
  const ctx: RuleContext = {
    input,
    params,
    trips,
    unplanned: plan.unplanned,
    orderById: lookups.orderById,
    planDow: dow,
  };
  const fixed = new Set(input.fixedTrips.map((t) => t.key));
  const own = trips.filter((t) => !fixed.has(t.key));
  return stableSort(own, (a, b) => compareText(a.key, b.key)).map((trip) => {
    const { schedule, stops } = scheduleOf(ctx, trip);
    const district = input.districts[trip.districtId];
    return {
      ...trip,
      departMin: schedule.departMin,
      returnMin: schedule.returnMin,
      stops: stops.flatMap((stop, i) => {
        const at = schedule.stops[i];
        if (!at) return [];
        return [
          {
            orderId: stop.order.id,
            travelMin: i === 0 ? (district?.depotToDistrictMin ?? 0) : (district?.interStopMin ?? 0),
            arriveMin: at.arriveMin,
            startMin: at.startMin,
            finishMin: at.finishMin,
            serviceMin: stop.allowanceMin,
            windowOpenMin: stop.effectiveOpenMin,
            windowCloseMin: stop.effectiveCloseMin,
          },
        ];
      }),
    };
  });
}
