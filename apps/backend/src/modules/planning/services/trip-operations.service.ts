import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  planSchedule,
  tripKeyOf,
  type Plan,
  type TripDraft,
  type Violation,
} from '@waypoint/engine';
import {
  type Actor,
  instantAt,
  tripMachine,
  type TripStatus,
} from '@waypoint/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  PlanLockedError,
  StateConflictError,
  ValidationError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deferrals,
  planRevisions,
  plans,
  stops,
  trips,
  users,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import { FuelLedgerService } from '../../fleet';
import { OrderLifecycleService } from '../../ordering';
import { DeferralService } from './deferral.service';
import { PLANNING_AUDIT, PLANNING_EVENTS } from '../planning.constants';
import type { PlanContext } from './plan-context.builder';
import { PlanContextBuilder } from './plan-context.builder';
import { PlanEngine } from './plan-engine';
import { PlansService } from './plans.service';
import { TripLifecycleService } from './trip-lifecycle.service';

type TripRow = typeof trips.$inferSelect;

export interface ReassignInput {
  vehicleId?: string;
  driverId?: string;
  reasonCode?: string;
  note?: string;
}

export interface ResequenceInput {
  stopIds: readonly string[];
  reasonCode?: string;
  note?: string;
}

/** 19b's preview: each stop's projected arrival, and what the order would break. */
export interface ResequencePreview {
  stops: {
    stopId: string;
    arrivalAt: string | null;
    spareMin: number | null;
  }[];
  violations: Violation[];
}

/** 20's driver picker. */
export interface DriverOption {
  driverId: string;
  name: string;
  tripsOnPlan: number;
}

/** Statuses a trip's remaining stops can be re-ordered in. */
const RESEQUENCEABLE = new Set<TripStatus>([
  'PLANNED',
  'LOADING',
  'RELEASED',
  'IN_PROGRESS',
]);

const minuteOfDay = (at: Date): number => {
  const local = new Date(at.getTime() + 330 * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

/** A violation's identity, to tell the ones a change introduced from those already there. */
const keyOf = (v: Violation) =>
  `${v.rule}|${v.tripKey ?? ''}|${v.orderId ?? ''}`;

/**
 * The changes 19b and 20 make to one trip of a published plan, each with a
 * reason, validated by the engine before anything is written:
 *
 * - reassign (AC-PLN-23): another vehicle, another driver, or both. The trip
 *   keeps its id; a released trip that moves to another vehicle goes back to
 *   LOADING so the dock loads it again, while a driver change leaves it as it is.
 * - resequence (AC-PLN-24): the stops still to come, in a new order, checked
 *   from now for a trip on the road and from its planned departure otherwise.
 *
 * Either one is a plan revision (`plan_revisions`, revision + 1), so the
 * driver's bundle, the dock and the stores it touches hear about it.
 */
@Injectable()
export class TripOperationsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly plans: PlansService,
    private readonly contexts: PlanContextBuilder,
    private readonly engine: PlanEngine,
    private readonly lifecycle: TripLifecycleService,
    private readonly orderLifecycle: OrderLifecycleService,
    private readonly deferralRules: DeferralService,
    private readonly fuel: FuelLedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(TripOperationsService.name);
  }

  @Transactional()
  async reassign(
    tripId: string,
    version: number,
    input: ReassignInput,
    actor: Actor,
  ): Promise<TripRow> {
    const reasonCode = this.reason(input.reasonCode);
    if (!input.vehicleId && !input.driverId)
      throw new ValidationError([
        {
          field: 'vehicleId',
          code: 'required',
          message: 'Pick another vehicle or another driver',
        },
      ]);
    const { trip, ctx } = await this.load(tripId, version, actor);
    if (!tripMachine.can(trip.status, 'REASSIGN'))
      throw new StateConflictError(
        `A ${trip.status.toLowerCase()} trip cannot be reassigned.`,
      );
    const vehicleChanged =
      input.vehicleId !== undefined && input.vehicleId !== trip.vehicleId;

    let changes: Partial<typeof trips.$inferInsert> = {};
    if (vehicleChanged) {
      const vehicle = ctx.vehicles.get(input.vehicleId!);
      const current = ctx.vehicles.get(trip.vehicleId);
      if (!vehicle || !current)
        throw new ValidationError([
          {
            field: 'vehicleId',
            code: 'unknown_vehicle',
            message: 'Not a vehicle of this depot',
          },
        ]);
      const used = new Set(
        [...ctx.tripsByKey.values()]
          .filter((t) => t.vehicleId === vehicle.id)
          .map((t) => t.tripNo),
      );
      const tripNo = [1, 2].find((n) => !used.has(n)) ?? 3;
      const oldKey = tripKeyOf(current.code, trip.tripNo ?? 1);
      const newKey = tripKeyOf(vehicle.code, tripNo);
      const next: Plan = {
        ...ctx.draft,
        trips: ctx.draft.trips.map((d) =>
          (d.key ??
            tripKeyOf(ctx.vehicles.get(d.vehicleId)?.code ?? '', d.tripNo)) ===
          oldKey
            ? { ...d, key: newKey, vehicleId: vehicle.id, tripNo }
            : d,
        ),
      };
      this.refuse(ctx, next, [newKey], input);
      const measured = planSchedule(ctx.input, next).find(
        (t) => t.key === newKey,
      );
      changes = {
        vehicleId: vehicle.id,
        tripNo,
        ...(measured && {
          plannedDepartAt: instantAt(ctx.plan.date, measured.departMin),
          plannedReturnAt: instantAt(ctx.plan.date, measured.returnMin),
          budgetMinutes: measured.minutes,
          plannedKm: measured.km,
          plannedFuelL: measured.litres,
        }),
      };
    }
    if (input.driverId) {
      await this.assertDriver(input.driverId, ctx.plan.depotId);
      changes.driverId = input.driverId;
    }

    // A released trip on another vehicle is loaded again (AC-LOD-19).
    let moved = trip;
    if (vehicleChanged && trip.status === 'RELEASED')
      moved = await this.lifecycle.markReloading(trip.id);
    const [saved] = await this.txHost.tx
      .update(trips)
      .set({
        ...changes,
        locked: true,
        version: moved.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(trips.id, trip.id), eq(trips.version, moved.version)))
      .returning();
    if (!saved) throw new VersionMismatchError('trip');

    if (vehicleChanged) {
      await this.fuel.reversePlanned([trip.id], `reassign: ${reasonCode}`);
      await this.fuel.addPlanned([
        {
          tripId: saved.id,
          vehicleId: saved.vehicleId,
          date: ctx.plan.date,
          km: saved.plannedKm,
          litres: saved.plannedFuelL,
        },
      ]);
    }
    const outletIds = this.outletsOf(ctx, trip.id);
    const revision = await this.revise(ctx, actor, {
      reasonCode,
      note: input.note,
      change: {
        op: 'REASSIGN',
        tripId: trip.id,
        ...(vehicleChanged && { vehicleId: saved.vehicleId }),
        ...(input.driverId && { driverId: input.driverId }),
      },
      tripId: trip.id,
      outletIds,
    });
    await this.audit.record({
      action: PLANNING_AUDIT.tripReassigned,
      entity: ['trip', trip.id],
      before: {
        vehicleId: trip.vehicleId,
        driverId: trip.driverId,
        status: trip.status,
      },
      after: {
        vehicleId: saved.vehicleId,
        driverId: saved.driverId,
        status: saved.status,
      },
      reasonCode,
      reasonNote: input.note?.trim() || undefined,
    });
    await this.outbox.add(
      PLANNING_EVENTS.tripReassigned,
      {
        v: 1,
        tripId: trip.id,
        planId: ctx.plan.id,
        depotId: ctx.plan.depotId,
        vehicleId: saved.vehicleId,
        previousVehicleId: trip.vehicleId,
        driverId: saved.driverId,
        vehicleChanged,
        revision,
        reasonCode,
      },
      { aggregate: ['trip', trip.id], depotId: ctx.plan.depotId, outletIds },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.tripReassigned,
        tripId: trip.id,
        planId: ctx.plan.id,
        reason: reasonCode,
        vehicleChanged,
      },
      'trip reassigned',
    );
    return saved;
  }

  @Transactional()
  async resequence(
    tripId: string,
    version: number,
    input: ResequenceInput,
    actor: Actor,
  ): Promise<TripRow> {
    const reasonCode = this.reason(input.reasonCode);
    const { trip, ctx } = await this.load(tripId, version, actor);
    if (!RESEQUENCEABLE.has(trip.status))
      throw new StateConflictError(
        `A ${trip.status.toLowerCase()} trip cannot be re-sequenced.`,
      );
    const { pending, byId, wanted, key, next } = this.inOrder(
      trip,
      ctx,
      input.stopIds,
    );
    this.refuse(ctx, next, [key], input);
    const measured = planSchedule(ctx.input, next).find((t) => t.key === key);
    const arrival = new Map(
      (measured?.stops ?? []).map((s) => [s.orderId, s.arriveMin]),
    );

    // The pending stops take the same seq numbers in the new order, freed first.
    const seqs = pending.map((s) => s.seq ?? 0).sort((a, b) => a - b);
    await this.txHost.tx
      .update(stops)
      .set({ seq: sql`-${stops.seq}` })
      .where(inArray(stops.id, wanted));
    for (const [i, id] of wanted.entries()) {
      const stop = byId.get(id)!;
      const arriveMin = arrival.get(stop.orderId);
      await this.txHost.tx
        .update(stops)
        .set({
          seq: seqs[i],
          ...(arriveMin !== undefined && {
            plannedArrivalAt: instantAt(ctx.plan.date, arriveMin),
          }),
          version: sql`${stops.version} + 1`,
          updatedAt: this.clock.realNow(),
        })
        .where(eq(stops.id, id));
    }
    const [saved] = await this.txHost.tx
      .update(trips)
      .set({
        locked: true,
        version: trip.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(trips.id, trip.id), eq(trips.version, trip.version)))
      .returning();
    if (!saved) throw new VersionMismatchError('trip');

    const outletIds = this.outletsOf(ctx, trip.id);
    const revision = await this.revise(ctx, actor, {
      reasonCode,
      note: input.note,
      change: { op: 'RESEQUENCE', tripId: trip.id, stopIds: wanted },
      tripId: trip.id,
      outletIds,
    });
    await this.audit.record({
      action: PLANNING_AUDIT.tripResequenced,
      entity: ['trip', trip.id],
      before: { stopIds: pending.map((s) => s.id) },
      after: { stopIds: wanted },
      reasonCode,
      reasonNote: input.note?.trim() || undefined,
    });
    await this.outbox.add(
      PLANNING_EVENTS.tripResequenced,
      {
        v: 1,
        tripId: trip.id,
        planId: ctx.plan.id,
        depotId: ctx.plan.depotId,
        stopIds: wanted,
        revision,
        reasonCode,
      },
      { aggregate: ['trip', trip.id], depotId: ctx.plan.depotId, outletIds },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.tripResequenced,
        tripId: trip.id,
        planId: ctx.plan.id,
        reason: reasonCode,
        stops: wanted.length,
      },
      'trip re-sequenced',
    );
    return saved;
  }

  /**
   * 19b's preview (AC-PLN-38): the projected arrival of each stop in this
   * order and what it would break, from the same engine check Apply runs.
   * Nothing is written.
   */
  @Transactional()
  async previewResequence(
    tripId: string,
    stopIds: readonly string[],
    actor: Actor,
  ): Promise<ResequencePreview> {
    const { trip, ctx } = await this.load(tripId, undefined, actor);
    if (!RESEQUENCEABLE.has(trip.status))
      throw new StateConflictError(
        `A ${trip.status.toLowerCase()} trip cannot be re-sequenced.`,
      );
    const { byId, wanted, key, next } = this.inOrder(trip, ctx, stopIds);
    const measured = planSchedule(ctx.input, next).find((t) => t.key === key);
    const atOf = new Map((measured?.stops ?? []).map((s) => [s.orderId, s]));
    return {
      stops: wanted.map((id) => {
        const stop = byId.get(id)!;
        const s = atOf.get(stop.orderId);
        return {
          stopId: id,
          arrivalAt: s
            ? instantAt(ctx.plan.date, s.arriveMin).toISOString()
            : null,
          spareMin: s ? Math.round(s.windowCloseMin - s.arriveMin) : null,
        };
      }),
      violations: this.introduced(ctx, next, [key]),
    };
  }

  /**
   * 19a and 19b: one stop still to come is taken off the trip (AC-PLN-25).
   * The stop is cancelled, its order waits as DEFERRED for the next run with
   * a confirmed deferral the store is told about, and the plan moves to its
   * next revision. A stop the driver has reached is theirs to finish (409).
   */
  @Transactional()
  async deferStop(
    tripId: string,
    stopId: string,
    version: number,
    input: { reasonCode?: string; note?: string },
    actor: Actor,
  ): Promise<TripRow> {
    const reasonCode = this.reason(input.reasonCode);
    await this.deferralRules.assertReason(reasonCode);
    const { trip, ctx } = await this.load(tripId, version, actor);
    const stop = (ctx.stopsByTrip.get(trip.id) ?? []).find(
      (s) => s.id === stopId,
    );
    if (!stop) throw new NotFoundError('stop');
    if (stop.status !== 'PENDING')
      throw new StateConflictError(
        'The driver has reached this stop; record its outcome instead.',
      );
    const order = ctx.orders.get(stop.orderId);
    if (!order) throw new NotFoundError('order');
    const note = input.note?.trim() || null;
    const toDate = await this.deferralRules.deferralDate(
      order.id,
      ctx.plan.date,
    );

    await this.lifecycle.cancelStop(stop.id, `deferred: ${reasonCode}`);
    await this.orderLifecycle.markDeferred(order.id, toDate);
    const [deferral] = await this.txHost.tx
      .insert(deferrals)
      .values({
        orderId: order.id,
        planId: ctx.plan.id,
        status: 'CONFIRMED',
        source: 'TRACKING',
        reasonCode,
        note,
        fromDate: ctx.plan.date,
        toDate,
        decidedById: actor.id,
        decidedAt: this.clock.now(),
      })
      .returning();
    const [saved] = await this.txHost.tx
      .update(trips)
      .set({
        locked: true,
        version: trip.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(trips.id, trip.id), eq(trips.version, trip.version)))
      .returning();
    if (!saved) throw new VersionMismatchError('trip');

    const revision = await this.revise(ctx, actor, {
      reasonCode,
      note: note ?? undefined,
      change: { op: 'DEFER_STOP', tripId: trip.id, stopId: stop.id },
      tripId: trip.id,
      outletIds: [stop.outletId],
    });
    await this.audit.record({
      action: PLANNING_AUDIT.stopDeferred,
      entity: ['stop', stop.id],
      before: { status: stop.status, orderStatus: order.status },
      after: { status: 'CANCELLED', toDate },
      reasonCode,
      reasonNote: note ?? undefined,
    });
    await this.outbox.add(
      PLANNING_EVENTS.stopDeferred,
      {
        v: 1,
        stopId: stop.id,
        tripId: trip.id,
        orderId: order.id,
        planId: ctx.plan.id,
        reasonCode,
        toDate,
        revision,
      },
      {
        aggregate: ['stop', stop.id],
        depotId: ctx.plan.depotId,
        outletIds: [stop.outletId],
      },
    );
    await this.outbox.add(
      PLANNING_EVENTS.deferralConfirmed,
      {
        v: 1,
        deferralId: deferral.id,
        orderId: order.id,
        orderNo: order.orderNo,
        reasonCode,
        toDate,
      },
      {
        aggregate: ['deferral', deferral.id],
        depotId: ctx.plan.depotId,
        outletIds: [stop.outletId],
      },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.stopDeferred,
        tripId: trip.id,
        stopId: stop.id,
        orderId: order.id,
        reason: reasonCode,
      },
      'stop deferred',
    );
    return saved;
  }

  /** 20's driver picker (AC-PLN-37): the depot's drivers and their trips on this plan. */
  @Transactional()
  async driverOptions(planId: string, actor: Actor): Promise<DriverOption[]> {
    const plan = await this.plans.lock(planId, actor);
    const drivers = await this.txHost.tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.role, 'driver'),
          eq(users.depotId, plan.depotId),
          sql`coalesce(${users.banned}, false) = false`,
        ),
      );
    const counts = await this.txHost.tx
      .select({ driverId: trips.driverId, n: sql<number>`count(*)::int` })
      .from(trips)
      .where(
        and(eq(trips.planId, plan.id), sql`${trips.status} <> 'CANCELLED'`),
      )
      .groupBy(trips.driverId);
    const tripsOf = new Map(counts.map((c) => [c.driverId, c.n]));
    return drivers
      .map((d) => ({
        driverId: d.id,
        name: d.name,
        tripsOnPlan: tripsOf.get(d.id) ?? 0,
      }))
      .sort(
        (a, b) => a.tripsOnPlan - b.tripsOnPlan || a.name.localeCompare(b.name),
      );
  }

  /**
   * The plan with this trip's stops still to come in the given order: the
   * ids must be exactly those stops. A trip on the road is scheduled from
   * now, as if at its last stop; one not yet out keeps its planned departure.
   */
  private inOrder(trip: TripRow, ctx: PlanContext, stopIds: readonly string[]) {
    const pending = (ctx.stopsByTrip.get(trip.id) ?? []).filter(
      (s) => s.status === 'PENDING',
    );
    const wanted = [...stopIds];
    const pendingIds = new Set(pending.map((s) => s.id));
    if (
      wanted.length !== pending.length ||
      new Set(wanted).size !== wanted.length ||
      !wanted.every((id) => pendingIds.has(id))
    )
      throw new ValidationError([
        {
          field: 'stopIds',
          code: 'not_the_pending_stops',
          message: 'List every stop still to come on this trip, once each',
        },
      ]);
    const byId = new Map(pending.map((s) => [s.id, s]));
    const orderIds = wanted.map((id) => byId.get(id)!.orderId);
    const code = ctx.vehicles.get(trip.vehicleId)?.code ?? trip.vehicleId;
    const key = tripKeyOf(code, trip.tripNo ?? 1);
    const district = ctx.districts.get(trip.districtId);
    const departMin =
      trip.status === 'IN_PROGRESS'
        ? minuteOfDay(this.clock.now()) -
          (district?.depotToDistrictMin ?? 0) +
          (district?.interStopMin ?? 0)
        : undefined;
    const next: Plan = {
      ...ctx.draft,
      trips: ctx.draft.trips.map((d): TripDraft =>
        (d.key ??
          tripKeyOf(ctx.vehicles.get(d.vehicleId)?.code ?? '', d.tripNo)) ===
        key
          ? {
              ...d,
              key,
              orderIds,
              ...(departMin !== undefined && { departMin }),
            }
          : d,
      ),
    };
    return { pending, byId, wanted, key, next };
  }

  private reason(code: string | undefined): string {
    const reasonCode = code?.trim();
    if (!reasonCode)
      throw new ValidationError([
        {
          field: 'reasonCode',
          code: 'required',
          message: 'A reason is required',
        },
      ]);
    return reasonCode;
  }

  /**
   * The trip, at the caller's version (writes; a preview passes none), on a
   * published plan in their scope.
   */
  private async load(
    tripId: string,
    version: number | undefined,
    actor: Actor,
  ): Promise<{ trip: TripRow; ctx: PlanContext }> {
    const [row] = await this.txHost.tx
      .select()
      .from(trips)
      .where(eq(trips.id, tripId));
    if (!row) throw new NotFoundError('trip');
    const plan = await this.plans.lock(row.planId, actor);
    if (plan.status === 'CLOSED')
      throw new PlanLockedError('The day is closed.');
    if (plan.status !== 'PUBLISHED')
      throw new StateConflictError(
        'Change a draft plan with its edit list; this is for a published one.',
      );
    if (version !== undefined && row.version !== version)
      throw new VersionMismatchError('trip');
    return { trip: row, ctx: await this.contexts.build(plan) };
  }

  /** What the change breaks on these trips that the plan did not break already. */
  private introduced(
    ctx: PlanContext,
    next: Plan,
    tripKeys: readonly string[],
  ): Violation[] {
    const before = new Set(
      this.engine.validate(ctx.input, ctx.draft).map(keyOf),
    );
    return this.engine
      .validate(ctx.input, next)
      .filter(
        (v) =>
          !before.has(keyOf(v)) && (!v.tripKey || tripKeys.includes(v.tripKey)),
      );
  }

  /** Refuses what the change broke on these trips, the same way an edit list does. */
  private refuse(
    ctx: PlanContext,
    next: Plan,
    tripKeys: readonly string[],
    input: { reasonCode?: string },
  ): void {
    this.plans.refuseIntroduced(ctx, this.introduced(ctx, next, tripKeys), {
      reasonCode: input.reasonCode,
    });
  }

  private outletsOf(ctx: PlanContext, tripId: string): string[] {
    return [
      ...new Set((ctx.stopsByTrip.get(tripId) ?? []).map((s) => s.outletId)),
    ].sort();
  }

  /** The plan's next revision, with a row saying what changed and why. */
  private async revise(
    ctx: PlanContext,
    actor: Actor,
    rev: {
      reasonCode: string;
      note?: string;
      change: Record<string, unknown>;
      tripId: string;
      outletIds: string[];
    },
  ): Promise<number> {
    const [plan] = await this.txHost.tx
      .update(plans)
      .set({
        revision: sql`${plans.revision} + 1`,
        version: sql`${plans.version} + 1`,
        updatedAt: this.clock.realNow(),
      })
      .where(eq(plans.id, ctx.plan.id))
      .returning({ revision: plans.revision });
    await this.txHost.tx.insert(planRevisions).values({
      planId: ctx.plan.id,
      revision: plan.revision,
      reasonCode: rev.reasonCode,
      note: rev.note?.trim() || null,
      changes: [rev.change],
      affectedTripIds: [rev.tripId],
      affectedOutletIds: rev.outletIds,
      createdById: actor.id,
    });
    return plan.revision;
  }

  private async assertDriver(id: string, depotId: string): Promise<void> {
    const [row] = await this.txHost.tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, id),
          eq(users.role, 'driver'),
          eq(users.depotId, depotId),
        ),
      );
    if (!row)
      throw new ValidationError([
        {
          field: 'driverId',
          code: 'not_a_driver',
          message: 'Not a driver at this depot',
        },
      ]);
  }
}
