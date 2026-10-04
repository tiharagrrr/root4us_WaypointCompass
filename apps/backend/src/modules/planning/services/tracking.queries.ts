import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  planSchedule,
  tripKeyOf,
  type Plan,
  type TripDraft,
} from '@waypoint/engine';
import { type Actor, businessDateOf, instantAt } from '@waypoint/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deferrals,
  depots,
  orders,
  outlets,
  plans,
  stopEvents,
  stops,
  trips,
  users,
  vehiclePositions,
  vehicles,
} from '../../../db/schema';
import type {
  TrackingDayDto,
  TrackingStopDto,
  TrackingTripDto,
} from '../dto/tracking.dto';
import { PlanScope } from '../policies/plan.scope';
import { PlanContextBuilder, type PlanContext } from './plan-context.builder';

type StopRow = typeof stops.$inferSelect;
type TripRow = typeof trips.$inferSelect;

/** A stop still to come this close to its window closing is at risk (19's amber). */
const AT_RISK_MIN = 15;
const DONE = new Set(['DELIVERED', 'PARTIAL', 'FAILED']);
/** 19 shows "No signal since" after this many silent minutes (specs/execution/spec.md, step 7). */
const NO_SIGNAL_MIN = 10;

type Signal = {
  position: TrackingTripDto['position'];
  lastSignalAt: Date | null;
};

const minuteOfDay = (at: Date): number => {
  const local = new Date(at.getTime() + 330 * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

/**
 * One depot's day on the road (01, 19, 19a): every live trip of the day's
 * plan with each stop planned, projected and actual, and the totals 01's KPI
 * row shows. A trip on the road has its stops still to come projected by the
 * engine's schedule from now, as if at its last stop (the same projection
 * 19b's preview uses); one not yet out keeps its planned arrivals. A stop
 * projected past its window is LATE, within 15 minutes of it AT_RISK.
 *
 * Read only; out of the dispatcher's scope is 404.
 */
@Injectable()
export class TrackingQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly scope: PlanScope,
    private readonly contexts: PlanContextBuilder,
  ) {}

  @Transactional()
  async day(
    depotId: string,
    date: string | undefined,
    actor: Actor,
  ): Promise<TrackingDayDto> {
    if (!this.scope.allowsDepot(depotId, actor))
      throw new NotFoundError('depot');
    const now = this.clock.now();
    const day = date ?? businessDateOf(now);
    const self = `/api/v1/depots/${depotId}/tracking?date=${day}`;
    const [plan] = await this.txHost.tx
      .select()
      .from(plans)
      .where(and(eq(plans.depotId, depotId), eq(plans.date, day)));
    const [depotRow] = await this.txHost.tx
      .select({ lat: depots.lat, lng: depots.lng })
      .from(depots)
      .where(eq(depots.id, depotId));
    const depot =
      depotRow?.lat != null && depotRow.lng != null
        ? { lat: depotRow.lat, lng: depotRow.lng }
        : null;
    const empty: TrackingDayDto = {
      depotId,
      date: day,
      planId: null,
      planStatus: null,
      depot,
      totals: {
        trips: 0,
        onRoad: 0,
        released: 0,
        stopsPlanned: 0,
        stopsDelivered: 0,
        lateRisk: 0,
        deferred: 0,
        repeatSkips: 0,
      },
      trips: [],
      _links: { self: { href: self } },
    };
    if (!plan) return empty;

    const tx = this.txHost.tx;
    const tripRows = await tx
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.planId, plan.id),
          sql`${trips.status} NOT IN ('CANCELLED', 'RESERVED')`,
        ),
      );
    const tripIds = tripRows.map((t) => t.id);
    const stopRows = tripIds.length
      ? await tx
          .select()
          .from(stops)
          .where(
            and(
              inArray(stops.tripId, tripIds),
              sql`${stops.status} <> 'CANCELLED'`,
            ),
          )
      : [];
    const vehicleIds = [...new Set(tripRows.map((t) => t.vehicleId))];
    const vehicleRows = vehicleIds.length
      ? await tx.select().from(vehicles).where(inArray(vehicles.id, vehicleIds))
      : [];
    const driverIds = tripRows.flatMap((t) => (t.driverId ? [t.driverId] : []));
    const driverRows = driverIds.length
      ? await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, driverIds))
      : [];
    const outletIds = [...new Set(stopRows.map((s) => s.outletId))];
    const outletRows = outletIds.length
      ? await tx
          .select({
            id: outlets.id,
            name: outlets.name,
            lat: outlets.lat,
            lng: outlets.lng,
          })
          .from(outlets)
          .where(inArray(outlets.id, outletIds))
      : [];
    const orderIds = stopRows.map((s) => s.orderId);
    const orderRows = orderIds.length
      ? await tx
          .select({ id: orders.id, orderNo: orders.orderNo })
          .from(orders)
          .where(inArray(orders.id, orderIds))
      : [];
    const deferralRows = await tx
      .select({ repeatSkip: deferrals.repeatSkip })
      .from(deferrals)
      .where(
        and(eq(deferrals.planId, plan.id), eq(deferrals.status, 'CONFIRMED')),
      );
    const vehicleOf = new Map(vehicleRows.map((v) => [v.id, v]));
    const driverOf = new Map(driverRows.map((d) => [d.id, d.name]));
    const outletOf = new Map(outletRows.map((o) => [o.id, o.name]));
    const pointOf = new Map(
      outletRows.map((o) => [
        o.id,
        o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null,
      ]),
    );
    const signals = await this.signals(tripRows);
    const orderOf = new Map(orderRows.map((o) => [o.id, o.orderNo]));

    // The engine's projection for trips on the road, from now.
    const onRoad = tripRows.filter((t) => t.status === 'IN_PROGRESS');
    const projected = onRoad.length
      ? this.project(await this.contexts.build(plan), onRoad, stopRows, now)
      : new Map<string, number>();

    const tripsOut = tripRows
      .map((t) =>
        this.trip(
          t,
          stopRows.filter((s) => s.tripId === t.id),
          projected,
          plan.date,
          {
            vehicle: vehicleOf.get(t.vehicleId),
            driverName: t.driverId ? (driverOf.get(t.driverId) ?? null) : null,
            outletName: (id) => outletOf.get(id) ?? id,
            orderNo: (id) => orderOf.get(id) ?? '',
            point: (id) => pointOf.get(id) ?? null,
          },
          signals.get(t.id) ?? { position: null, lastSignalAt: null },
          now,
        ),
      )
      .sort(
        (a, b) =>
          rank(a.standing) - rank(b.standing) ||
          a.vehicleCode.localeCompare(b.vehicleCode) ||
          (a.tripNo ?? 0) - (b.tripNo ?? 0),
      );

    const allStops = tripsOut.flatMap((t) => t.stops);
    return {
      depotId,
      date: day,
      planId: plan.id,
      planStatus: plan.status,
      depot,
      totals: {
        trips: tripsOut.length,
        onRoad: onRoad.length,
        released: tripRows.filter((t) =>
          ['RELEASED', 'IN_PROGRESS', 'COMPLETED'].includes(t.status),
        ).length,
        stopsPlanned: allStops.length,
        stopsDelivered: allStops.filter(
          (s) => s.standing === 'DELIVERED' || s.standing === 'PARTIAL',
        ).length,
        lateRisk: allStops.filter((s) => s.standing === 'LATE').length,
        deferred: deferralRows.length,
        repeatSkips: deferralRows.filter((d) => d.repeatSkip).length,
      },
      trips: tripsOut,
      _links: {
        self: { href: self },
        plan: { href: `/api/v1/plans/${plan.id}` },
        endOfDay: { href: `/api/v1/plans/${plan.id}/end-of-day` },
      },
    };
  }

  /**
   * Each trip's latest position (written by execution's ping pipeline, read
   * here) and its last signal: the newest of that position, its stop events
   * and its start.
   */
  private async signals(
    tripRows: readonly TripRow[],
  ): Promise<Map<string, Signal>> {
    const out = new Map<string, Signal>();
    const ids = tripRows.map((t) => t.id);
    if (!ids.length) return out;
    const tx = this.txHost.tx;
    const positions = await tx
      .select()
      .from(vehiclePositions)
      .where(inArray(vehiclePositions.tripId, ids));
    const events = await tx
      .select({
        tripId: stopEvents.tripId,
        at: sql<Date>`max(${stopEvents.occurredAt})`.mapWith(
          (v: string | Date) => new Date(v),
        ),
      })
      .from(stopEvents)
      .where(inArray(stopEvents.tripId, ids))
      .groupBy(stopEvents.tripId);
    const positionOf = new Map(positions.map((p) => [p.tripId, p]));
    const eventOf = new Map(events.map((e) => [e.tripId, e.at]));
    for (const t of tripRows) {
      const p = positionOf.get(t.id);
      const times = [p?.recordedAt, eventOf.get(t.id), t.startedAt].filter(
        (d): d is Date => d instanceof Date,
      );
      out.set(t.id, {
        position: p
          ? {
              lat: p.lat,
              lng: p.lng,
              heading: p.heading,
              speedKmh: p.speedKmh,
              recordedAt: this.clock.toIso(p.recordedAt),
            }
          : null,
        lastSignalAt: times.length
          ? new Date(Math.max(...times.map((d) => d.getTime())))
          : null,
      });
    }
    return out;
  }

  /** Projected arrival minute per stop id still to come, for the trips on the road. */
  private project(
    ctx: PlanContext,
    onRoad: readonly TripRow[],
    stopRows: readonly StopRow[],
    now: Date,
  ): Map<string, number> {
    const out = new Map<string, number>();
    const keyOf = (d: TripDraft) =>
      d.key ?? tripKeyOf(ctx.vehicles.get(d.vehicleId)?.code ?? '', d.tripNo);
    const pendingOf = new Map<string, StopRow[]>();
    const drafts = new Map<string, Partial<TripDraft>>();
    for (const trip of onRoad) {
      const pending = stopRows
        .filter((s) => s.tripId === trip.id && s.status === 'PENDING')
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const code = ctx.vehicles.get(trip.vehicleId)?.code ?? trip.vehicleId;
      const key = tripKeyOf(code, trip.tripNo ?? 1);
      const district = ctx.districts.get(trip.districtId);
      pendingOf.set(key, pending);
      drafts.set(key, {
        orderIds: pending.map((s) => s.orderId),
        departMin:
          minuteOfDay(now) -
          (district?.depotToDistrictMin ?? 0) +
          (district?.interStopMin ?? 0),
      });
    }
    const next: Plan = {
      ...ctx.draft,
      trips: ctx.draft.trips
        .map((d) => {
          const change = drafts.get(keyOf(d));
          return change ? { ...d, key: keyOf(d), ...change } : d;
        })
        .filter((d) => d.orderIds.length > 0),
    };
    for (const scheduled of planSchedule(ctx.input, next)) {
      const pending = pendingOf.get(scheduled.key);
      if (!pending) continue;
      const byOrder = new Map(pending.map((s) => [s.orderId, s.id]));
      for (const s of scheduled.stops) {
        const stopId = byOrder.get(s.orderId);
        if (stopId) out.set(stopId, s.arriveMin);
      }
    }
    return out;
  }

  private trip(
    t: TripRow,
    tripStops: StopRow[],
    projected: ReadonlyMap<string, number>,
    date: string,
    names: {
      vehicle: typeof vehicles.$inferSelect | undefined;
      driverName: string | null;
      outletName: (id: string) => string;
      orderNo: (id: string) => string;
      point: (id: string) => { lat: number; lng: number } | null;
    },
    signal: Signal,
    now: Date,
  ): TrackingTripDto {
    const iso = (at: Date | null) => (at ? this.clock.toIso(at) : null);
    const ordered = [...tripStops].sort((a, b) => {
      const sa = a.seq ?? Number.MAX_SAFE_INTEGER;
      const sb = b.seq ?? Number.MAX_SAFE_INTEGER;
      return sa - sb;
    });
    let nextSeen = false;
    const stopsOut: TrackingStopDto[] = ordered.map((s) => {
      const etaMin = projected.get(s.id);
      const plannedMin = s.plannedArrivalAt
        ? minuteOfDay(s.plannedArrivalAt)
        : null;
      const pending = !DONE.has(s.status);
      const basis = pending ? (etaMin ?? plannedMin) : null;
      const spareMin =
        basis === null ? null : Math.round(s.windowCloseMin - basis);
      let standing: TrackingStopDto['standing'];
      if (s.status === 'DELIVERED') standing = 'DELIVERED';
      else if (s.status === 'PARTIAL') standing = 'PARTIAL';
      else if (s.status === 'FAILED') standing = 'FAILED';
      else if (spareMin !== null && spareMin < 0) standing = 'LATE';
      else if (t.status === 'IN_PROGRESS' && !nextSeen) standing = 'NEXT';
      else if (spareMin !== null && spareMin < AT_RISK_MIN)
        standing = 'AT_RISK';
      else standing = 'PLANNED';
      if (pending && t.status === 'IN_PROGRESS') nextSeen = true;
      return {
        stopId: s.id,
        seq: s.seq,
        orderNo: names.orderNo(s.orderId),
        outletId: s.outletId,
        outletName: names.outletName(s.outletId),
        at: names.point(s.outletId),
        status: s.status,
        windowOpenMin: s.windowOpenMin,
        windowCloseMin: s.windowCloseMin,
        plannedArrivalAt: iso(s.plannedArrivalAt),
        etaAt:
          etaMin !== undefined
            ? this.clock.toIso(instantAt(date, etaMin))
            : null,
        spareMin,
        arrivedAt: iso(s.arrivedAt),
        completedAt: iso(s.completedAt),
        standing,
      };
    });
    const next = stopsOut.find((s) => !DONE.has(s.status));
    const late = stopsOut.some((s) => s.standing === 'LATE');
    const standing: TrackingTripDto['standing'] =
      t.status === 'COMPLETED'
        ? 'COMPLETE'
        : t.status === 'LOADING'
          ? 'LOADING'
          : late
            ? 'LATE_RISK'
            : t.status === 'IN_PROGRESS' || t.status === 'RELEASED'
              ? 'ON_TIME'
              : 'PLANNED';
    return {
      tripId: t.id,
      vehicleCode: names.vehicle?.code ?? t.vehicleId,
      vehicleType: names.vehicle?.type ?? 'TRUCK',
      vehicleTemp: names.vehicle?.temp ?? 'AMBIENT',
      tripNo: t.tripNo,
      driverName: names.driverName,
      brand: t.brand,
      tempClass: t.tempClass,
      status: t.status,
      standing,
      cantRunReason: t.cantRunReason,
      delivered: stopsOut.filter(
        (s) => s.standing === 'DELIVERED' || s.standing === 'PARTIAL',
      ).length,
      stopsTotal: stopsOut.length,
      nextEtaAt: next ? (next.etaAt ?? next.plannedArrivalAt) : null,
      nextOutletName: next?.outletName ?? null,
      nextWindowOpenMin: next?.windowOpenMin ?? null,
      nextWindowCloseMin: next?.windowCloseMin ?? null,
      plannedDepartAt: iso(t.plannedDepartAt),
      loadWeightKg: t.loadWeightKg,
      loadVolumeM3: t.loadVolumeM3,
      position: signal.position,
      lastSignalAt:
        t.status === 'IN_PROGRESS' && signal.lastSignalAt
          ? this.clock.toIso(signal.lastSignalAt)
          : null,
      noSignalSince:
        t.status === 'IN_PROGRESS' &&
        signal.lastSignalAt &&
        now.getTime() - signal.lastSignalAt.getTime() >= NO_SIGNAL_MIN * 60_000
          ? this.clock.toIso(signal.lastSignalAt)
          : null,
      stops: stopsOut,
    };
  }
}

/** Late first, then on the road, then the rest: the order 19's list reads in. */
function rank(standing: TrackingTripDto['standing']): number {
  return ['LATE_RISK', 'ON_TIME', 'LOADING', 'PLANNED', 'COMPLETE'].indexOf(
    standing,
  );
}
