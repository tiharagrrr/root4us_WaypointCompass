import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  planSchedule,
  tripKeyOf,
  type Plan,
  type TripDraft,
} from '@waypoint/engine';
import { type Actor, businessDateOf, instantAt } from '@waypoint/shared';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { stampActor, SYSTEM_ACTOR } from '../../../db/actor';
import {
  deferrals,
  orders,
  outlets,
  plans,
  stops,
  trips,
  users,
  vehicles,
} from '../../../db/schema';
import type {
  OrderEtaDto,
  TrackingDayDto,
  TrackingStopDto,
  TrackingTripDto,
} from '../dto/tracking.dto';
import { PlanScope } from '../policies/plan.scope';
import { OrderQueries } from '../../ordering';
import { PlanContextBuilder, type PlanContext } from './plan-context.builder';

type StopRow = typeof stops.$inferSelect;
type TripRow = typeof trips.$inferSelect;

/** A stop still to come this close to its window closing is at risk (19's amber). */
const AT_RISK_MIN = 15;
const DONE = new Set(['DELIVERED', 'PARTIAL', 'FAILED']);

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
    private readonly orderQueries: OrderQueries,
  ) {}

  @Transactional()
  async day(
    depotId: string,
    date: string | undefined,
    actor: Actor,
  ): Promise<TrackingDayDto> {
    if (!this.scope.allowsDepot(depotId, actor))
      throw new NotFoundError('depot');
    return this.dayOf(depotId, date);
  }

  /**
   * M3: when one order is due (AC-EXE-22). The order is read inside the caller's own scope,
   * so another outlet's order is 404; the answer is the order's stop out of the same
   * projection the dispatcher sees, without the vehicle or its position.
   */
  @Transactional()
  async orderEta(orderId: string, actor: Actor): Promise<OrderEtaDto> {
    const order = await this.orderQueries.get(orderId, actor);
    const base = {
      orderId: order.id,
      orderNo: order.orderNo,
      _links: {
        self: { href: `/api/v1/orders/${order.id}/eta` },
        order: { href: `/api/v1/orders/${order.id}` },
      },
    };
    const none: OrderEtaDto = {
      ...base,
      stopId: null,
      tripStatus: null,
      stopStatus: null,
      plannedArrivalAt: null,
      etaAt: null,
      spareMin: null,
      standing: null,
      completedAt: null,
    };
    const tx = this.txHost.tx;
    const [stop] = await tx
      .select({ id: stops.id, tripId: stops.tripId })
      .from(stops)
      .where(and(eq(stops.orderId, order.id), ne(stops.status, 'CANCELLED')))
      .orderBy(desc(stops.createdAt))
      .limit(1);
    if (!stop) return none;
    const [trip] = await tx
      .select({
        status: trips.status,
        date: plans.date,
        depotId: plans.depotId,
      })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(eq(trips.id, stop.tripId));
    if (!trip) return none;
    const day = await this.asSystem(actor, () =>
      this.dayOf(trip.depotId, trip.date),
    );
    const view = day.trips
      .flatMap((t) => t.stops)
      .find((s) => s.stopId === stop.id);
    if (!view) return none;
    const pending = view.completedAt === null && view.status !== 'FAILED';
    return {
      ...base,
      stopId: view.stopId,
      tripStatus: trip.status,
      stopStatus: view.status,
      plannedArrivalAt: view.plannedArrivalAt,
      etaAt: pending ? (view.etaAt ?? view.plannedArrivalAt) : null,
      spareMin: view.spareMin,
      standing: view.standing,
      completedAt: view.completedAt,
    };
  }

  /**
   * Runs a read with the transaction stamped as the system, then stamps the caller back.
   * The projection needs every order on the trip, and row-level security hides other
   * outlets' orders from a store; the caller has already been checked against the one
   * order she asked about, and only that order's stop leaves this class.
   */
  private async asSystem<T>(actor: Actor, work: () => Promise<T>): Promise<T> {
    const tx = this.txHost.tx;
    await stampActor(tx, SYSTEM_ACTOR);
    try {
      return await work();
    } finally {
      // A failed transaction cannot be stamped again, and is rolled back anyway.
      await stampActor(tx, actor).catch(() => undefined);
    }
  }

  /** The day's trips and totals, with no scope check: callers decide who may see what. */
  private async dayOf(
    depotId: string,
    date: string | undefined,
  ): Promise<TrackingDayDto> {
    const now = this.clock.now();
    const day = date ?? businessDateOf(now);
    const self = `/api/v1/depots/${depotId}/tracking?date=${day}`;
    const [plan] = await this.txHost.tx
      .select()
      .from(plans)
      .where(and(eq(plans.depotId, depotId), eq(plans.date, day)));
    const empty: TrackingDayDto = {
      depotId,
      date: day,
      planId: null,
      planStatus: null,
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
          .select({ id: outlets.id, name: outlets.name })
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
          },
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
    },
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
