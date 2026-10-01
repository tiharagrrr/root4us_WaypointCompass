import type { EngineParams } from '../params';
import type { EngineDistrict } from '../types';

// Windows and display only. Budgets always use the booklet minutes (trip-minutes.ts).

export interface ScheduleStopInput {
  allowanceMin: number;
  windowOpenMin: number;
  windowCloseMin: number;
}

export interface ScheduleInput {
  departMin: number;
  district: Pick<EngineDistrict, 'depotToDistrictMin' | 'interStopMin'>;
  /** In visiting order. */
  stops: readonly ScheduleStopInput[];
}

export interface ScheduledStop {
  arriveMin: number;
  startMin: number;
  waitMin: number;
  finishMin: number;
}

export interface TripSchedule {
  departMin: number;
  stops: ScheduledStop[];
  /** Back at the depot: last finish plus the depot-to-district leg again. */
  returnMin: number;
}

/**
 * First arrival is departure plus the depot-to-district minutes; each later arrival is the previous
 * finish plus the inter-stop minutes. A vehicle that arrives early waits for the window to open.
 */
export function scheduleTrip({ departMin, district, stops }: ScheduleInput): TripSchedule {
  const scheduled: ScheduledStop[] = [];
  let arriveMin = departMin + district.depotToDistrictMin;
  let lastFinishMin = departMin;
  for (const stop of stops) {
    const startMin = Math.max(arriveMin, stop.windowOpenMin);
    const finishMin = startMin + stop.allowanceMin;
    scheduled.push({ arriveMin, startMin, waitMin: startMin - arriveMin, finishMin });
    lastFinishMin = finishMin;
    arriveMin = finishMin + district.interStopMin;
  }
  const returnMin =
    scheduled.length === 0 ? departMin : lastFinishMin + district.depotToDistrictMin;
  return { departMin, stops: scheduled, returnMin };
}

/** Trip 2 departs after trip 1 returns plus the reload time. */
export function nextTripDepartMin(
  previous: Pick<TripSchedule, 'returnMin'>,
  params: Pick<EngineParams, 'reloadMin'>,
): number {
  return previous.returnMin + params.reloadMin;
}
