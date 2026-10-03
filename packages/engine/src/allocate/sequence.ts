import { stopsOf, type Stop } from '../plan/stops';
import { tripDepartMin } from '../plan/trip-schedule';
import { scheduleTrip } from '../time/schedule';
import type { EngineDistrict, RuleContext, Trip } from '../types';
import { lte } from '../util/lte';
import { compareText, stableSort } from '../util/stable-sort';
import { districtOf, ruleContextOf, type AllocContext } from './context';

/** What a visiting order costs: windows it breaks first, then minutes spent waiting at the kerb. */
interface SequenceCost {
  breaks: number;
  waitMin: number;
}

function costOf(
  ctx: RuleContext,
  trip: Trip,
  district: EngineDistrict,
  stops: readonly Stop[],
): SequenceCost {
  const departMin = tripDepartMin(ctx, trip, stops, district.depotToDistrictMin);
  const schedule = scheduleTrip({
    departMin,
    district,
    stops: stops.map((s) => ({
      allowanceMin: s.allowanceMin,
      windowOpenMin: s.effectiveOpenMin,
      windowCloseMin: s.effectiveCloseMin,
    })),
  });
  let breaks = 0;
  let waitMin = 0;
  stops.forEach((stop, i) => {
    const at = schedule.stops[i];
    if (!at) return;
    waitMin += at.waitMin;
    if (!lte(stop.effectiveOpenMin, at.startMin) || !lte(at.finishMin, stop.effectiveCloseMin)) breaks += 1;
  });
  return { breaks, waitMin };
}

/** Fewer broken windows wins, then less waiting. Positions are tried from the back, so a tie leaves
 * the stop where its window close put it. */
function isBetter(candidate: SequenceCost, best: SequenceCost): boolean {
  if (candidate.breaks !== best.breaks) return candidate.breaks < best.breaks;
  return !lte(best.waitMin, candidate.waitMin);
}

/**
 * The trip's stops in visiting order: sorted by effective window close, then each inserted where it
 * adds the least waiting while keeping every window. Trip minutes do not change with the order, so
 * this moves only when each stop is reached.
 *
 * It always returns an order, even when no order keeps every window: the window rules then report
 * the break and the packer refuses the placement.
 */
export function sequenceStops(
  ctx: RuleContext,
  trip: Trip,
  district: EngineDistrict,
  stops: readonly Stop[],
): Stop[] {
  const byClose = stableSort(
    stops,
    (a, b) =>
      a.effectiveCloseMin - b.effectiveCloseMin ||
      a.effectiveOpenMin - b.effectiveOpenMin ||
      compareText(a.order.ref, b.order.ref),
  );
  let ordered: Stop[] = [];
  for (const stop of byClose) {
    let best: { stops: Stop[]; cost: SequenceCost } | null = null;
    // From the back: with nothing to choose between two positions the stop stays in window-close
    // order, which is the order the stops were taken in.
    for (let at = ordered.length; at >= 0; at -= 1) {
      const candidate = [...ordered.slice(0, at), stop, ...ordered.slice(at)];
      const cost = costOf(ctx, { ...trip, orderIds: candidate.map((s) => s.order.id) }, district, candidate);
      if (best === null || isBetter(cost, best.cost)) best = { stops: candidate, cost };
    }
    ordered = best === null ? [...ordered, stop] : best.stops;
  }
  return ordered;
}

/**
 * The same trip with its stops in visiting order. A trip whose orders the input does not describe (a
 * released trip in repair mode) is left exactly as it came.
 */
export function sequenceTrip(ctx: AllocContext, others: readonly Trip[], trip: Trip): Trip {
  if (trip.orderIds.length < 2) return trip;
  const rctx = ruleContextOf(ctx, stableSort([...others, trip], (a, b) => compareText(a.key, b.key)));
  const stops = stopsOf(rctx, trip);
  if (stops.length !== trip.orderIds.length) return trip;
  const ordered = sequenceStops(rctx, trip, districtOf(ctx, trip.districtId), stops);
  return { ...trip, orderIds: ordered.map((s) => s.order.id) };
}

/**
 * The departure the schedule derives for this trip, pinned onto it. Done once the plan is final, in
 * trip order, so a Fresh trip 2 leaves after trip 1 has its own stops.
 */
export function withDepartMin(ctx: AllocContext, trips: readonly Trip[], trip: Trip): Trip {
  const rctx = ruleContextOf(ctx, trips);
  const stops = stopsOf(rctx, trip);
  if (stops.length === 0) return trip;
  const district = districtOf(ctx, trip.districtId);
  return { ...trip, departMin: tripDepartMin(rctx, trip, stops, district.depotToDistrictMin) };
}
