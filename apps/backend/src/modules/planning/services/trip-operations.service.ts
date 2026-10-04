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
import { planRevisions, plans, stops, trips, users } from '../../../db/schema';
import { AuditService } from '../../audit';
import { FuelLedgerService } from '../../fleet';
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
    const tripStops = ctx.stopsByTrip.get(trip.id) ?? [];
    const pending = tripStops.filter((s) => s.status === 'PENDING');
    const wanted = [...input.stopIds];
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

    // The engine checks the stops still to come, from now when the trip is on the road.
    const code = ctx.vehicles.get(trip.vehicleId)?.code ?? trip.vehicleId;
    const key = tripKeyOf(code, trip.tripNo ?? 1);
    const district = ctx.districts.get(trip.districtId);
    const started = trip.status === 'IN_PROGRESS';
    const departMin = started
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

  /** The trip, at the caller's version, on a published plan in their scope. */
  private async load(
    tripId: string,
    version: number,
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
    if (row.version !== version) throw new VersionMismatchError('trip');
    return { trip: row, ctx: await this.contexts.build(plan) };
  }

  /** Refuses what the change broke on these trips, the same way an edit list does. */
  private refuse(
    ctx: PlanContext,
    next: Plan,
    tripKeys: readonly string[],
    input: { reasonCode?: string },
  ): void {
    const before = new Set(
      this.engine.validate(ctx.input, ctx.draft).map(keyOf),
    );
    const introduced = this.engine
      .validate(ctx.input, next)
      .filter(
        (v) =>
          !before.has(keyOf(v)) && (!v.tripKey || tripKeys.includes(v.tripKey)),
      );
    this.plans.refuseIntroduced(ctx, introduced, {
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
