import { createHash } from 'node:crypto';
import {
  DEFAULT_TRAVEL_MINUTES,
  FAILED_REASONS,
  RECEIVER_NAMES,
} from '../simulation.constants';

const MIN = 60_000;

export interface DriverTrip {
  id: string;
  status: string;
  districtId: string;
  plannedDepartAt: Date | null;
  startedAt: Date | null;
}

export interface DriverStop {
  id: string;
  seq: number | null;
  status: string;
  plannedArrivalAt: Date | null;
  plannedTravelMin: number | null;
  plannedServiceMin: number;
  arrivedAt: Date | null;
  completedAt: Date | null;
}

/** An injection as the driver sees it: what, when and on what. */
export interface Trouble {
  kind: string;
  atSim: Date;
  target: unknown;
  params: unknown;
}

export interface DriverStep {
  type: 'TRIP_STARTED' | 'ARRIVED' | 'DELIVERED' | 'FAILED' | 'TRIP_COMPLETED';
  stopId: string | null;
  at: Date;
  receiverName?: string;
  outcome?: (typeof FAILED_REASONS)[number];
}

const DONE = new Set(['DELIVERED', 'PARTIAL', 'FAILED']);

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;

/** Extra minutes on a leg that starts while a road delay holds the district. */
export function delayMinutes(
  at: Date,
  districtId: string,
  travelMin: number,
  trouble: readonly Trouble[],
): number {
  let extra = 0;
  for (const t of trouble) {
    if (t.kind !== 'ROAD_DELAY' || field(t.target, 'districtId') !== districtId)
      continue;
    const minutes = Number(field(t.params, 'minutes') ?? 0);
    const index = Math.min(
      100,
      Math.max(10, Number(field(t.params, 'speedIndex') ?? 100)),
    );
    const from = t.atSim.getTime();
    if (at.getTime() < from || at.getTime() >= from + minutes * MIN) continue;
    extra = Math.max(extra, Math.round(travelMin * (100 / index - 1)));
  }
  return extra;
}

/**
 * What a trip's virtual driver has to record by `now`, oldest first, given the
 * trip as the database holds it. It leaves at the planned departure, reaches
 * each stop at its planned arrival (never before finishing the stop before
 * it, and later while a road delay holds the district), serves for the planned
 * service time, and completes the trip after the last stop. The same rows,
 * trouble and seed always give the same steps (AC-SIM-03's ground rule): no
 * clock and no random number is read here.
 */
export function stepsDue(
  trip: DriverTrip,
  stops: readonly DriverStop[],
  trouble: readonly Trouble[],
  now: Date,
  seed: number,
): DriverStep[] {
  const steps: DriverStep[] = [];
  let cursor: Date;
  if (trip.status === 'RELEASED') {
    if (!trip.plannedDepartAt || trip.plannedDepartAt > now) return steps;
    steps.push({
      type: 'TRIP_STARTED',
      stopId: null,
      at: trip.plannedDepartAt,
    });
    cursor = trip.plannedDepartAt;
  } else if (trip.status === 'IN_PROGRESS') {
    cursor = trip.startedAt ?? trip.plannedDepartAt ?? now;
  } else return steps;

  for (const stop of stops) {
    if (stop.status === 'CANCELLED') continue;
    if (DONE.has(stop.status)) {
      if (stop.completedAt && stop.completedAt > cursor)
        cursor = stop.completedAt;
      continue;
    }
    let arrive = stop.arrivedAt;
    if (stop.status === 'PENDING' || !arrive) {
      const planned = stop.plannedArrivalAt ?? cursor;
      const base = planned > cursor ? planned : cursor;
      const extra = delayMinutes(
        base,
        trip.districtId,
        stop.plannedTravelMin ?? DEFAULT_TRAVEL_MINUTES,
        trouble,
      );
      arrive = new Date(base.getTime() + extra * MIN);
      if (arrive > now) return steps;
      steps.push({ type: 'ARRIVED', stopId: stop.id, at: arrive });
    }
    const done = new Date(arrive.getTime() + stop.plannedServiceMin * MIN);
    if (done > now) return steps;
    const failure = trouble.find(
      (t) =>
        t.kind === 'FAILED_DELIVERY' &&
        field(t.target, 'stopId') === stop.id &&
        t.atSim <= done,
    );
    if (failure) {
      const reason = field(failure.params, 'reason');
      steps.push({
        type: 'FAILED',
        stopId: stop.id,
        at: done,
        outcome: FAILED_REASONS.find((r) => r === reason) ?? 'OUTLET_CLOSED',
      });
    } else
      steps.push({
        type: 'DELIVERED',
        stopId: stop.id,
        at: done,
        receiverName:
          RECEIVER_NAMES[(seed + (stop.seq ?? 0)) % RECEIVER_NAMES.length],
      });
    cursor = done;
  }
  steps.push({ type: 'TRIP_COMPLETED', stopId: null, at: cursor });
  return steps;
}

/** A stable UUID for one step of one run, so a repeated tick is a replay, not a second event. */
export function stepUuid(
  runId: string,
  tripId: string,
  step: DriverStep,
  salt = '',
): string {
  const hex = createHash('sha1')
    .update([runId, tripId, step.stopId ?? '', step.type, salt].join(':'))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
