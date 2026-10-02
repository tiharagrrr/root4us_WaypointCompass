import { nextTripDepartMin, scheduleTrip, type TripSchedule } from '../time/schedule';
import type { RuleContext, Trip } from '../types';
import { stopsOf, type Stop } from './stops';

function departureOf(ctx: RuleContext, trip: Trip, stops: readonly Stop[], depotToDistrictMin: number): number {
  if (trip.departMin !== undefined) return trip.departMin;
  if (trip.brand === 'FRESH') {
    const first = ctx.trips.find((t) => t.vehicleId === trip.vehicleId && t.tripNo === 1 && t.key !== trip.key);
    if (trip.tripNo > 1 && first) return nextTripDepartMin(scheduleOf(ctx, first).schedule, ctx.params);
    return ctx.params.freshStartMin;
  }
  // Style and Tech: arrive when the first window opens, until the allocator picks a wave.
  const firstOpen = stops[0]?.effectiveOpenMin ?? 0;
  return Math.max(0, firstOpen - depotToDistrictMin);
}

/**
 * When each stop of the trip is reached, in visiting order. Fresh trip 1 leaves at the Fresh start;
 * trip 2 leaves after trip 1 returns plus the reload. Windows and display only.
 */
export function scheduleOf(ctx: RuleContext, trip: Trip): { schedule: TripSchedule; stops: Stop[] } {
  const stops = stopsOf(ctx, trip);
  const district = ctx.input.districts[trip.districtId];
  if (!district) return { schedule: { departMin: 0, stops: [], returnMin: 0 }, stops: [] };
  const departMin = departureOf(ctx, trip, stops, district.depotToDistrictMin);
  const schedule = scheduleTrip({
    departMin,
    district,
    stops: stops.map((s) => ({
      allowanceMin: s.allowanceMin,
      windowOpenMin: s.effectiveOpenMin,
      windowCloseMin: s.effectiveCloseMin,
    })),
  });
  return { schedule, stops };
}
