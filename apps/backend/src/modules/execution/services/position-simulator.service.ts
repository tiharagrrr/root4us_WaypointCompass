import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  depots,
  outlets,
  stops,
  trips,
  vehiclePositions,
} from '../../../db/schema';
import { type PingInput, TelematicsService } from './telematics.service';

/** A real phone that reported this recently owns the vehicle; the simulator keeps off it. */
const REAL_DEVICE_MS = 2 * 60 * 1000;
/** With no planned arrival to aim at, a leg takes this long. */
const DEFAULT_LEG_MS = 20 * 60 * 1000;
/** The simulated vehicle stops short of the outlet: arriving is the driver's event, not ours. */
const MAX_PROGRESS = 0.97;
const DONE = new Set(['DELIVERED', 'PARTIAL', 'FAILED']);

type Point = { lat: number; lng: number };

/**
 * Demo only: moves every IN_PROGRESS trip along its stops on the demo clock,
 * so 19's map is alive without a phone on every truck. Each tick a vehicle sits
 * on the straight line from where it last was (the depot, or its last stop)
 * towards its next stop, as far along as the time to that stop's planned
 * arrival says. The fixes go through the real ping pipeline as the simulator,
 * so the trail, the throttled `vehicle.position` and the signal watch all see
 * them exactly as they would see a phone's.
 */
@Injectable()
export class PositionSimulator {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly telematics: TelematicsService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(PositionSimulator.name);
  }

  async step(): Promise<number> {
    const now = this.clock.now();
    const pings = await this.fixes(now);
    if (!pings.length) return 0;
    const result = await this.telematics.receive(pings, { kind: 'simulator' });
    return result.accepted;
  }

  /** One fix per simulated trip, for `now`. Pure reads. */
  async fixes(now: Date): Promise<PingInput[]> {
    const tx = this.txHost.tx;
    const running = await tx
      .select({
        id: trips.id,
        vehicleId: trips.vehicleId,
        depotId: trips.depotId,
        startedAt: trips.startedAt,
      })
      .from(trips)
      .where(eq(trips.status, 'IN_PROGRESS'));
    if (!running.length) return [];
    const ids = running.map((t) => t.id);

    const positions = await tx
      .select()
      .from(vehiclePositions)
      .where(
        inArray(
          vehiclePositions.vehicleId,
          running.map((t) => t.vehicleId),
        ),
      );
    const realOf = new Set(
      positions
        .filter(
          (p) =>
            p.source !== 'simulator' &&
            now.getTime() - p.recordedAt.getTime() < REAL_DEVICE_MS,
        )
        .map((p) => p.vehicleId),
    );
    const stopRows = await tx
      .select({
        tripId: stops.tripId,
        seq: stops.seq,
        status: stops.status,
        plannedArrivalAt: stops.plannedArrivalAt,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        lat: outlets.lat,
        lng: outlets.lng,
      })
      .from(stops)
      .innerJoin(outlets, eq(outlets.id, stops.outletId))
      .where(and(inArray(stops.tripId, ids)))
      .orderBy(asc(stops.seq));
    const depotRows = await tx
      .select({ id: depots.id, lat: depots.lat, lng: depots.lng })
      .from(depots)
      .where(
        inArray(
          depots.id,
          running.map((t) => t.depotId),
        ),
      );
    const depotOf = new Map(depotRows.map((d) => [d.id, d]));

    const out: PingInput[] = [];
    for (const trip of running) {
      if (realOf.has(trip.vehicleId)) continue;
      const depot = depotOf.get(trip.depotId);
      const route = stopRows.filter(
        (s) => s.tripId === trip.id && s.status !== 'CANCELLED',
      );
      const at = whereNow(
        depot?.lat != null && depot.lng != null
          ? { lat: depot.lat, lng: depot.lng }
          : null,
        trip.startedAt,
        route,
        now,
      );
      if (!at) continue;
      out.push({
        tripId: trip.id,
        lat: Number(at.lat.toFixed(6)),
        lng: Number(at.lng.toFixed(6)),
        accuracyM: 10,
        speedKmh: at.moving ? 32 : 0,
        heading: at.heading,
        recordedAt: now.toISOString(),
      });
    }
    return out;
  }
}

/**
 * Where a vehicle is at `now`: at the outlet it is arrived at, or part of the
 * way from its last point (the depot, or the last finished stop) to its next
 * stop, by the time left to that stop's planned arrival.
 */
export function whereNow(
  depot: Point | null,
  startedAt: Date | null,
  route: {
    status: string;
    plannedArrivalAt: Date | null;
    arrivedAt: Date | null;
    completedAt: Date | null;
    lat: number | null;
    lng: number | null;
  }[],
  now: Date,
): (Point & { heading: number | null; moving: boolean }) | null {
  const point = (s: { lat: number | null; lng: number | null }) =>
    s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
  const arrived = route.find((s) => s.status === 'ARRIVED');
  if (arrived) {
    const p = point(arrived);
    return p ? { ...p, heading: null, moving: false } : null;
  }
  const next = route.find((s) => !DONE.has(s.status));
  const finished = route.filter((s) => DONE.has(s.status));
  const last = finished.at(-1);
  const from = (last && point(last)) ?? depot;
  const leftAt =
    last?.completedAt ??
    last?.arrivedAt ??
    startedAt ??
    new Date(now.getTime() - 60_000);
  if (!next) return from ? { ...from, heading: null, moving: false } : null;
  const to = point(next);
  if (!from || !to) return to ? { ...to, heading: null, moving: false } : null;
  const dueAt =
    next.plannedArrivalAt && next.plannedArrivalAt > leftAt
      ? next.plannedArrivalAt
      : new Date(leftAt.getTime() + DEFAULT_LEG_MS);
  const span = Math.max(1, dueAt.getTime() - leftAt.getTime());
  const progress = Math.min(
    MAX_PROGRESS,
    Math.max(0, (now.getTime() - leftAt.getTime()) / span),
  );
  const heading =
    (Math.atan2(to.lng - from.lng, to.lat - from.lat) * 180) / Math.PI;
  return {
    lat: from.lat + (to.lat - from.lat) * progress,
    lng: from.lng + (to.lng - from.lng) * progress,
    heading: Math.round((heading + 360) % 360),
    moving: progress < MAX_PROGRESS,
  };
}
