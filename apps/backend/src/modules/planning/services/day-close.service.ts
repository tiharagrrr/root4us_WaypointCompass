import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { type Actor, can, instantAt, type Link } from '@waypoint/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  PlanLockedError,
  StateConflictError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deferrals,
  issues,
  orders,
  outlets,
  plans,
  stops,
  syncConflicts,
  trips,
  users,
  vehicles,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import { FuelLedgerService } from '../../fleet';
import { OrderLifecycleService } from '../../ordering';
import type {
  EndOfDayDto,
  EndOfDayFollowUpDto,
  EndOfDayTripDto,
} from '../dto/end-of-day.dto';
import { PLANNING_AUDIT, PLANNING_EVENTS } from '../planning.constants';
import { DeferralService } from './deferral.service';
import type { PlanRow } from './plan-context.builder';
import { PlansService } from './plans.service';
import { TripLifecycleService } from './trip-lifecycle.service';

type TripRow = typeof trips.$inferSelect;
type StopRow = typeof stops.$inferSelect;

/** Trips still at the dock or on the road: the day cannot close under them. */
const RUNNING = new Set(['LOADING', 'RELEASED', 'IN_PROGRESS']);
/** Trips that never left the depot: closing cancels them. */
const NEVER_RAN = new Set(['RESERVED', 'PLANNED']);
/** Stops nobody served: closing defers their orders. */
const UNSERVED = new Set(['PENDING', 'ARRIVED']);

const RUNNING_WORDS: Record<string, string> = {
  LOADING: 'still loading',
  RELEASED: 'released and not yet back',
  IN_PROGRESS: 'still on the road',
};

/** A failed stop's outcome, as the deferral's reason. */
const REASON_OF_OUTCOME: Record<string, string> = {
  OUTLET_CLOSED: 'ACCESS_ISSUE',
  REFUSED: 'STORE_REQUEST',
};

const OUTCOME_WORDS: Record<string, string> = {
  OUTLET_CLOSED: 'Outlet closed on arrival',
  REFUSED: 'The store refused it',
  DAMAGED: 'Goods damaged',
};

interface Day {
  plan: PlanRow;
  trips: TripRow[];
  stops: StopRow[];
  conflicts: Map<string, number>;
}

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/**
 * The end of the day (21): what each trip did, what needs following up, and
 * closing the day (AC-PLN-29). Closing turns every stop nobody served into a
 * confirmed deferral to the next run, cancels trips that never ran, records
 * each finished trip's fuel as ACTUAL, and locks the plan. It is refused while
 * a trip is loading or on the road, or a sync conflict is open (19c), because
 * the day's record is not final until those settle.
 */
@Injectable()
export class DayCloseService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly plans: PlansService,
    private readonly lifecycle: TripLifecycleService,
    private readonly orderLifecycle: OrderLifecycleService,
    private readonly deferralService: DeferralService,
    private readonly fuel: FuelLedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DayCloseService.name);
  }

  /** 21: the day's results, follow-ups and close blockers, with `close` when it can close. */
  @Transactional()
  async endOfDay(id: string, actor: Actor): Promise<EndOfDayDto> {
    const day = await this.load(await this.plans.lock(id, actor));
    const { plan } = day;
    const vehicleCode = await this.vehicleCodes(day.trips);
    const driverName = await this.names(
      day.trips.flatMap((t) => (t.driverId ? [t.driverId] : [])),
    );
    const outletName = await this.outletNames(day.stops);
    const live = day.stops.filter((s) => s.status !== 'CANCELLED');
    const count = (rows: StopRow[], status: string) =>
      rows.filter((s) => s.status === status).length;
    const onTime = (rows: StopRow[]) => {
      const arrived = rows.filter((s) => s.arrivedAt);
      const inside = arrived.filter(
        (s) =>
          s.arrivedAt!.getTime() <=
          instantAt(plan.date, s.windowCloseMin).getTime(),
      );
      return pct(inside.length, arrived.length);
    };

    const tripRows: EndOfDayTripDto[] = day.trips.map((t) => {
      const mine = live.filter((s) => s.tripId === t.id);
      return {
        tripId: t.id,
        vehicleCode: vehicleCode.get(t.vehicleId) ?? t.vehicleId,
        tripNo: t.tripNo ?? 1,
        driverName: t.driverId ? (driverName.get(t.driverId) ?? null) : null,
        status: t.status,
        stops: mine.length,
        delivered: count(mine, 'DELIVERED'),
        partial: count(mine, 'PARTIAL'),
        failed: count(mine, 'FAILED'),
        onTimePct: onTime(mine),
        openConflicts: day.conflicts.get(t.id) ?? 0,
      };
    });

    const blockers = this.blockers(day, vehicleCode);
    const [{ deferred }] = await this.txHost.tx
      .select({ deferred: sql<number>`count(*)::int` })
      .from(deferrals)
      .where(
        and(eq(deferrals.planId, plan.id), eq(deferrals.status, 'CONFIRMED')),
      );
    const self = `/api/v1/plans/${plan.id}`;
    const close: Link | false = plan.status === 'PUBLISHED' &&
      can(actor, 'plan:close') &&
      blockers.length === 0 && {
        href: `${self}/close`,
        method: 'POST',
        title: 'Close the day',
        requires: ['If-Match', 'Idempotency-Key'],
      };

    return {
      planId: plan.id,
      depotId: plan.depotId,
      date: plan.date,
      status: plan.status,
      closedAt: plan.closedAt?.toISOString() ?? null,
      totals: {
        stops: live.length,
        delivered: count(live, 'DELIVERED'),
        partial: count(live, 'PARTIAL'),
        failed: count(live, 'FAILED'),
        unserved: live.filter((s) => UNSERVED.has(s.status)).length,
        onTimePct: onTime(live),
        deferred,
      },
      trips: tripRows,
      followUps: await this.followUps(day, vehicleCode, outletName),
      closeBlockers: blockers,
      _links: {
        self: { href: `${self}/end-of-day` },
        plan: { href: self },
        ...(close ? { close } : {}),
      },
    };
  }

  /** AC-PLN-29: close the published plan at the version the caller read. */
  @Transactional()
  async close(id: string, version: number, actor: Actor): Promise<PlanRow> {
    const locked = await this.plans.lock(id, actor);
    if (locked.status === 'CLOSED')
      throw new PlanLockedError('The day is already closed.');
    if (locked.status !== 'PUBLISHED')
      throw new StateConflictError('Only a published plan can be closed.');
    if (locked.version !== version) throw new VersionMismatchError('plan');
    const day = await this.load(locked);
    const blockers = this.blockers(day, await this.vehicleCodes(day.trips));
    if (blockers.length) throw new StateConflictError(blockers.join('; '));
    const { plan } = day;
    const tx = this.txHost.tx;

    // Every stop nobody served becomes a deferral to the next run.
    const unserved = day.stops.filter(
      (s) => UNSERVED.has(s.status) || s.status === 'FAILED',
    );
    const orderRows = unserved.length
      ? await tx
          .select()
          .from(orders)
          .where(
            inArray(
              orders.id,
              unserved.map((s) => s.orderId),
            ),
          )
      : [];
    const orderOf = new Map(orderRows.map((o) => [o.id, o]));
    const created: (typeof deferrals.$inferSelect)[] = [];
    for (const stop of unserved) {
      const order = orderOf.get(stop.orderId);
      if (!order || order.activeStopId !== stop.id) continue;
      if (stop.status === 'PENDING')
        await this.lifecycle.cancelStop(stop.id, 'not served by close');
      else if (stop.status === 'ARRIVED')
        await this.lifecycle.markStopOutcome(stop.id, {
          outcome: 'OUTLET_CLOSED',
          at: this.clock.now(),
          note: 'No outcome recorded by close',
        });
      const toDate = await this.deferralService.deferralDate(
        order.id,
        plan.date,
      );
      if (order.status === 'FAILED')
        await this.orderLifecycle.requeue(order.id);
      await this.orderLifecycle.markDeferred(order.id, toDate);
      const why =
        stop.status === 'FAILED'
          ? (stop.exceptionNote ??
            OUTCOME_WORDS[stop.outcome ?? ''] ??
            'Not delivered')
          : 'Not reached on this run';
      const [row] = await tx
        .insert(deferrals)
        .values({
          orderId: order.id,
          planId: plan.id,
          status: 'CONFIRMED',
          source: 'TRACKING',
          reasonCode: REASON_OF_OUTCOME[stop.outcome ?? ''] ?? 'OTHER',
          note: `${why}. It goes on the next run.`,
          fromDate: plan.date,
          toDate,
          decidedById: actor.id,
          decidedAt: this.clock.now(),
        })
        .returning();
      created.push(row);
      await this.outbox.add(
        PLANNING_EVENTS.deferralConfirmed,
        {
          v: 1,
          deferralId: row.id,
          orderId: order.id,
          orderNo: order.orderNo,
          reasonCode: row.reasonCode,
          toDate,
        },
        {
          aggregate: ['deferral', row.id],
          depotId: plan.depotId,
          outletIds: [order.outletId],
        },
      );
    }

    // Trips that never left are cancelled; finished ones book their fuel as ACTUAL.
    for (const trip of day.trips.filter((t) => NEVER_RAN.has(t.status)))
      await this.lifecycle.cancelTrip(trip.id, 'did not run');
    const finished = day.trips.filter((t) => t.status === 'COMPLETED');
    await this.fuel.recordActual(
      finished.map((t) => ({
        tripId: t.id,
        vehicleId: t.vehicleId,
        date: plan.date,
        km: t.plannedKm,
        litres: t.plannedFuelL,
      })),
    );

    const [closed] = await tx
      .update(plans)
      .set({
        status: 'CLOSED',
        closedAt: this.clock.now(),
        closedById: actor.id,
        version: sql`${plans.version} + 1`,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(plans.id, plan.id), eq(plans.version, version)))
      .returning();
    if (!closed) throw new VersionMismatchError('plan');

    await this.audit.record({
      action: PLANNING_AUDIT.planClosed,
      entity: ['plan', plan.id],
      before: { status: 'PUBLISHED' },
      after: {
        status: 'CLOSED',
        deferred: created.length,
        tripsCompleted: finished.length,
      },
    });
    await this.outbox.add(
      PLANNING_EVENTS.planClosed,
      {
        v: 1,
        planId: plan.id,
        depotId: plan.depotId,
        date: plan.date,
        deferralIds: created.map((d) => d.id),
        tripIds: finished.map((t) => t.id),
      },
      { aggregate: ['plan', plan.id], depotId: plan.depotId },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.planClosed,
        planId: plan.id,
        deferred: created.length,
        trips: finished.length,
      },
      'day closed',
    );
    return closed;
  }

  /** The plan's live trips, their stops and open conflicts. */
  private async load(plan: PlanRow): Promise<Day> {
    const tx = this.txHost.tx;
    const tripRows = await tx
      .select()
      .from(trips)
      .where(
        and(eq(trips.planId, plan.id), sql`${trips.status} <> 'CANCELLED'`),
      )
      .orderBy(trips.vehicleId, trips.tripNo);
    const ids = tripRows.map((t) => t.id);
    const stopRows = ids.length
      ? await tx.select().from(stops).where(inArray(stops.tripId, ids))
      : [];
    const open = ids.length
      ? await tx
          .select({
            tripId: syncConflicts.tripId,
            n: sql<number>`count(*)::int`,
          })
          .from(syncConflicts)
          .where(
            and(
              inArray(syncConflicts.tripId, ids),
              eq(syncConflicts.status, 'OPEN'),
            ),
          )
          .groupBy(syncConflicts.tripId)
      : [];
    return {
      plan,
      trips: tripRows,
      stops: stopRows,
      conflicts: new Map(open.map((c) => [c.tripId, c.n])),
    };
  }

  private blockers(day: Day, codes: Map<string, string>): string[] {
    const code = (t: TripRow) => codes.get(t.vehicleId) ?? t.vehicleId;
    return [
      ...day.trips
        .filter((t) => RUNNING.has(t.status))
        .map((t) => `${code(t)} is ${RUNNING_WORDS[t.status]}`),
      ...day.trips
        .filter((t) => (day.conflicts.get(t.id) ?? 0) > 0)
        .map(
          (t) =>
            `${code(t)} has ${day.conflicts.get(t.id)} sync conflict${day.conflicts.get(t.id) === 1 ? '' : 's'} to resolve`,
        ),
    ];
  }

  private async followUps(
    day: Day,
    codes: Map<string, string>,
    outletName: Map<string, string>,
  ): Promise<EndOfDayFollowUpDto[]> {
    const name = (s: StopRow) => outletName.get(s.outletId) ?? s.outletId;
    const items: EndOfDayFollowUpDto[] = [];
    for (const s of day.stops) {
      if (s.status === 'FAILED')
        items.push({
          kind: 'FAILED_STOP',
          title: `Failed stop · ${name(s)}`,
          detail:
            s.exceptionNote ??
            OUTCOME_WORDS[s.outcome ?? ''] ??
            'Not delivered',
          tripId: s.tripId,
          orderId: s.orderId,
        });
      else if (s.status === 'PARTIAL')
        items.push({
          kind: 'SHORT',
          title: `Short · ${name(s)}`,
          detail: s.exceptionNote ?? 'Part of the order was delivered.',
          tripId: s.tripId,
          orderId: s.orderId,
        });
      else if (UNSERVED.has(s.status))
        items.push({
          kind: 'NOT_REACHED',
          title: `Not reached · ${name(s)}`,
          detail:
            'Closing the day defers it to the next run, and the store is told.',
          tripId: s.tripId,
          orderId: s.orderId,
        });
    }
    const stopIds = day.stops.map((s) => s.id);
    const openIssues = stopIds.length
      ? await this.txHost.tx
          .select()
          .from(issues)
          .where(
            and(inArray(issues.stopId, stopIds), eq(issues.status, 'OPEN')),
          )
      : [];
    for (const issue of openIssues)
      items.push({
        kind: 'ISSUE',
        title: `Issue · ${outletName.get(issue.outletId) ?? issue.outletId}`,
        detail: issue.description,
        tripId: day.stops.find((s) => s.id === issue.stopId)?.tripId ?? null,
        orderId: issue.orderId,
      });
    for (const t of day.trips) {
      const n = day.conflicts.get(t.id) ?? 0;
      if (n)
        items.push({
          kind: 'SYNC_CONFLICT',
          title: `${codes.get(t.vehicleId) ?? t.vehicleId} · ${n} record${n === 1 ? '' : 's'} to resolve`,
          detail: 'The phone and the server disagree. Resolve it on 19c.',
          tripId: t.id,
          orderId: null,
        });
    }
    return items;
  }

  private async vehicleCodes(rows: TripRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((t) => t.vehicleId))];
    if (!ids.length) return new Map();
    const found = await this.txHost.tx
      .select({ id: vehicles.id, code: vehicles.code })
      .from(vehicles)
      .where(inArray(vehicles.id, ids));
    return new Map(found.map((v) => [v.id, v.code]));
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const found = await this.txHost.tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map(found.map((u) => [u.id, u.name]));
  }

  private async outletNames(rows: StopRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((s) => s.outletId))];
    if (!ids.length) return new Map();
    const found = await this.txHost.tx
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(inArray(outlets.id, ids));
    return new Map(found.map((o) => [o.id, o.name]));
  }
}
