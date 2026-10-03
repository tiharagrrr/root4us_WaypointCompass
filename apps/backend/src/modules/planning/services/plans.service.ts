import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Violation } from '@waypoint/engine';
import type { Actor } from '@waypoint/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  PlanLockedError,
  RuleViolationError,
  StateConflictError,
  ValidationError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  depots,
  depotWaves,
  planRevisions,
  plans,
  stops,
  trips,
  users,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import { FuelLedgerService } from '../../fleet';
import { OrderLifecycleService } from '../../ordering';
import { PublishBlockedError, PublishNotOpenError } from '../domain/errors';
import { parsePlanEdits, type MetaOp } from '../domain/plan-edits';
import { PLANNING_AUDIT, PLANNING_EVENTS } from '../planning.constants';
import { PlanScope } from '../policies/plan.scope';
import {
  PlanContextBuilder,
  type PlanContext,
  type PlanRow,
} from './plan-context.builder';
import { PlanEngine } from './plan-engine';
import { PlanWriter } from './plan-writer';
import { PublishPolicy } from './publish.policy';

/** Trips a revision's edit list cannot change (AC-PLN-22). */
const FROZEN_TRIPS = new Set(['RELEASED', 'IN_PROGRESS', 'COMPLETED']);

/** An order's live stop and its trip. */
type Carried = Map<string, { stopId: string; tripId: string }>;

export interface EditInput {
  ops: readonly unknown[];
  reasonCode?: string;
  note?: string;
  overrideNote?: string;
}

/**
 * The plan's commands: open a day's plan, apply an edit list, publish
 * (specs/planning/spec.md). Each runs in one transaction with its audit row,
 * outbox event and log line; every write checks the plan's version
 * (If-Match), so two dispatchers never interleave moves (AC-PLN-07).
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly scope: PlanScope,
    private readonly contexts: PlanContextBuilder,
    private readonly engine: PlanEngine,
    private readonly writer: PlanWriter,
    private readonly publishing: PublishPolicy,
    private readonly lifecycle: OrderLifecycleService,
    private readonly fuel: FuelLedgerService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(PlansService.name);
  }

  /** One plan per depot and date, created as a DRAFT on first access (AC-PLN-08). */
  @Transactional()
  async getOrCreate(
    depotId: string,
    date: string,
    actor: Actor,
  ): Promise<PlanRow> {
    if (!this.scope.allowsDepot(depotId, actor))
      throw new NotFoundError('plan');
    const [depot] = await this.txHost.tx
      .select({ id: depots.id })
      .from(depots)
      .where(eq(depots.id, depotId));
    if (!depot) throw new NotFoundError('depot');

    const [created] = await this.txHost.tx
      .insert(plans)
      .values({ depotId, date, createdById: actor.id })
      .onConflictDoNothing({ target: [plans.depotId, plans.date] })
      .returning();
    if (created) {
      await this.audit.record({
        action: PLANNING_AUDIT.planCreated,
        entity: ['plan', created.id],
        after: { depotId, date, status: created.status },
      });
      this.log.info(
        {
          event: PLANNING_AUDIT.planCreated,
          planId: created.id,
          depotId,
          date,
        },
        'plan created',
      );
      return created;
    }
    const [row] = await this.txHost.tx
      .select()
      .from(plans)
      .where(and(eq(plans.depotId, depotId), eq(plans.date, date)));
    return row;
  }

  /**
   * One edit list from 08, 10 or 11 (AC-PLN-02, 13, 14). A hard violation the
   * edits cause is 422 with the violations and a `fixes` link; a soft one
   * needs a reason code and an override note. The trips the edits touch are
   * locked, so Auto-suggest keeps them (AC-PLN-10). On a published plan the
   * same edit list is a revision (AC-PLN-21, 22).
   */
  @Transactional()
  async edit(
    id: string,
    version: number,
    input: EditInput,
    actor: Actor,
  ): Promise<PlanContext> {
    const ctx = await this.loadEditable(id, version, actor);
    if (ctx.plan.status === 'PUBLISHED') return this.revise(ctx, input, actor);
    const parsed = parsePlanEdits(input.ops);
    const result = this.engine.applyEdits(ctx.input, ctx.draft, parsed.engine);
    this.refuseIntroduced(ctx, result.introduced, input);

    const tripIds = await this.writer.save(ctx, result.plan, {
      lockChanged: true,
    });
    await this.applyMeta(ctx.plan, parsed.meta);
    const plan = await this.bump(ctx.plan);

    const soft = result.introduced.filter((v) => v.severity === 'SOFT');
    await this.audit.record({
      action: PLANNING_AUDIT.planEdited,
      entity: ['plan', plan.id],
      before: { version: ctx.plan.version },
      after: {
        version: plan.version,
        ops: input.ops.length,
        trips: tripIds.length,
      },
    });
    if (soft.length)
      await this.audit.record({
        action: PLANNING_AUDIT.softRuleOverridden,
        entity: ['plan', plan.id],
        after: { rules: soft.map((v) => v.rule) },
        reasonCode: input.reasonCode,
        reasonNote: input.overrideNote,
      });
    await this.outbox.add(
      PLANNING_EVENTS.planEdited,
      { v: 1, planId: plan.id, version: plan.version, tripIds },
      { aggregate: ['plan', plan.id], depotId: plan.depotId },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.planEdited,
        planId: plan.id,
        ops: input.ops.length,
        trips: tripIds.length,
      },
      'plan edited',
    );
    return this.contexts.build(plan);
  }

  /**
   * A change to a published plan (AC-PLN-21, 22): a reason is required; trips
   * the dock has released, or that are on the road or done, cannot change
   * here (reassign, re-sequence and stop defer have their own commands); the
   * orders follow their stops through OrderLifecycleService; the touched
   * trips' planned fuel is reversed and booked again; and the plan moves to
   * the next revision, which notifies only the trips and outlets it touched.
   */
  private async revise(
    ctx: PlanContext,
    input: EditInput,
    actor: Actor,
  ): Promise<PlanContext> {
    const reasonCode = input.reasonCode?.trim();
    if (!reasonCode)
      throw new ValidationError([
        {
          field: 'reasonCode',
          code: 'required',
          message: 'A reason is required',
        },
      ]);
    const note = input.note?.trim() || null;
    const parsed = parsePlanEdits(input.ops);
    const result = this.engine.applyEdits(ctx.input, ctx.draft, parsed.engine);
    this.refuseIntroduced(ctx, result.introduced, input);

    // What the plan carried before; read now, because the writer changes ctx.
    const frozen = new Set(
      [...ctx.tripsByKey.values()]
        .filter((t) => FROZEN_TRIPS.has(t.status))
        .map((t) => t.id),
    );
    const before: Carried = new Map();
    for (const [tripId, list] of ctx.stopsByTrip)
      for (const stop of list)
        before.set(stop.orderId, { stopId: stop.id, tripId });

    const saved = await this.writer.save(ctx, result.plan, {
      lockChanged: true,
    });
    if (saved.some((tripId) => frozen.has(tripId)))
      throw new StateConflictError(
        'A released trip takes only a reassign, a re-sequence or a stop deferral.',
      );
    const metaTrips = await this.applyMeta(ctx.plan, parsed.meta);
    const tripIds = [...new Set([...saved, ...metaTrips])].sort();

    // Orders follow their stops: newly carried ones are planned, moved ones
    // take their new stop, and ones off every trip go back to the queue.
    const after = await this.liveStops(ctx.plan.id);
    const moved = new Set<string>();
    for (const [orderId, now] of after) {
      const was = before.get(orderId);
      if (!was) await this.lifecycle.markPlanned(orderId, now.stopId);
      else if (was.tripId !== now.tripId)
        await this.lifecycle.moveStop(orderId, now.stopId);
      else continue;
      moved.add(orderId);
    }
    for (const orderId of before.keys())
      if (!after.has(orderId)) {
        await this.lifecycle.requeue(orderId);
        moved.add(orderId);
      }
    const outletIds = [
      ...new Set(
        [...moved]
          .map((orderId) => ctx.orders.get(orderId)?.outletId)
          .filter((o): o is string => Boolean(o)),
      ),
    ].sort();

    // Fuel: take back what the touched trips had planned, book what they plan now.
    await this.fuel.reversePlanned(saved, `revision: ${reasonCode}`);
    const carrying = new Set([...after.values()].map((s) => s.tripId));
    const rebooked = saved.filter((tripId) => carrying.has(tripId));
    const live = rebooked.length
      ? await this.txHost.tx
          .select()
          .from(trips)
          .where(inArray(trips.id, rebooked))
      : [];
    await this.fuel.addPlanned(
      live.map((t) => ({
        tripId: t.id,
        vehicleId: t.vehicleId,
        date: ctx.plan.date,
        km: t.plannedKm,
        litres: t.plannedFuelL,
      })),
    );

    const [plan] = await this.txHost.tx
      .update(plans)
      .set({
        revision: sql`${plans.revision} + 1`,
        version: sql`${plans.version} + 1`,
        updatedAt: this.clock.realNow(),
      })
      .where(
        and(eq(plans.id, ctx.plan.id), eq(plans.version, ctx.plan.version)),
      )
      .returning();
    if (!plan) throw new VersionMismatchError('plan');

    await this.txHost.tx.insert(planRevisions).values({
      planId: plan.id,
      revision: plan.revision,
      reasonCode,
      note,
      changes: input.ops as Record<string, unknown>[],
      affectedTripIds: tripIds,
      affectedOutletIds: outletIds,
      createdById: actor.id,
    });
    const soft = result.introduced.filter((v) => v.severity === 'SOFT');
    if (soft.length)
      await this.audit.record({
        action: PLANNING_AUDIT.softRuleOverridden,
        entity: ['plan', plan.id],
        after: { rules: soft.map((v) => v.rule) },
        reasonCode,
        reasonNote: input.overrideNote,
      });
    await this.audit.record({
      action: PLANNING_AUDIT.planRevised,
      entity: ['plan', plan.id],
      before: { revision: ctx.plan.revision, version: ctx.plan.version },
      after: {
        revision: plan.revision,
        version: plan.version,
        trips: tripIds.length,
        outlets: outletIds.length,
      },
      reasonCode,
      reasonNote: note ?? undefined,
    });
    // Loading needs at least one trip to act on; a revision that changed none has nothing to tell.
    if (tripIds.length)
      await this.outbox.add(
        PLANNING_EVENTS.planRevised,
        {
          v: 1,
          planId: plan.id,
          depotId: plan.depotId,
          date: plan.date,
          revision: plan.revision,
          tripIds,
          reasonCode,
          note,
        },
        { aggregate: ['plan', plan.id], depotId: plan.depotId, outletIds },
      );
    this.log.info(
      {
        event: PLANNING_AUDIT.planRevised,
        planId: plan.id,
        revision: plan.revision,
        reason: reasonCode,
        trips: tripIds.length,
        outlets: outletIds.length,
      },
      'plan revised',
    );
    return this.contexts.build(plan);
  }

  /** Each order on a live stop of the plan, read back after the writer saved. */
  private async liveStops(planId: string): Promise<Carried> {
    const rows = await this.txHost.tx
      .select({
        stopId: stops.id,
        tripId: stops.tripId,
        orderId: stops.orderId,
      })
      .from(stops)
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .where(
        and(
          eq(trips.planId, planId),
          sql`${stops.status} NOT IN ('CANCELLED', 'FAILED')`,
        ),
      );
    return new Map(
      rows.map((r) => [r.orderId, { stopId: r.stopId, tripId: r.tripId }]),
    );
  }

  /**
   * Revision 1 (AC-PLN-03, 04, 19, 20). Orders on a trip become PLANNED on
   * their stop, orders with a confirmed deferral become DEFERRED on its date,
   * each trip's planned fuel goes in the ledger, empty reservations are
   * cancelled, and the store hears about each deferral now (D6).
   */
  @Transactional()
  async publish(
    id: string,
    version: number,
    actor: Actor,
  ): Promise<PlanContext> {
    const plan = await this.lock(id, actor);
    if (plan.status !== 'DRAFT')
      throw new StateConflictError(`The plan is already ${plan.status}.`);
    if (plan.version !== version) throw new VersionMismatchError('plan');

    const ctx = await this.contexts.build(plan);
    const check = await this.publishing.check(ctx);
    if (!check.open) throw new PublishNotOpenError(check.opensAt);
    if (check.blockers.length) throw new PublishBlockedError(check.blockers);

    const now = this.clock.now();
    const tx = this.txHost.tx;
    const live = [...ctx.tripsByKey.values()];
    const carrying = live.filter(
      (t) => (ctx.stopsByTrip.get(t.id) ?? []).length > 0,
    );
    const empty = live.filter((t) => !carrying.includes(t));
    if (empty.length)
      await tx
        .update(trips)
        .set({
          status: 'CANCELLED',
          tripNo: null,
          cancelReason: 'empty at publish',
          updatedAt: this.clock.realNow(),
        })
        .where(
          inArray(
            trips.id,
            empty.map((t) => t.id),
          ),
        );

    for (const trip of carrying)
      for (const stop of ctx.stopsByTrip.get(trip.id) ?? [])
        await this.lifecycle.markPlanned(stop.orderId, stop.id);

    const confirmed = [...ctx.deferrals.values()].filter(
      (d) => d.status === 'CONFIRMED',
    );
    for (const deferral of confirmed) {
      await this.lifecycle.markDeferred(deferral.orderId, deferral.toDate);
      const order = ctx.orders.get(deferral.orderId);
      await this.outbox.add(
        PLANNING_EVENTS.deferralConfirmed,
        {
          v: 1,
          deferralId: deferral.id,
          orderId: deferral.orderId,
          orderNo: order?.orderNo ?? null,
          reasonCode: deferral.reasonCode,
          toDate: deferral.toDate,
        },
        {
          aggregate: ['deferral', deferral.id],
          depotId: plan.depotId,
          outletIds: order ? [order.outletId] : [],
        },
      );
    }

    await this.fuel.addPlanned(
      carrying.map((t) => ({
        tripId: t.id,
        vehicleId: t.vehicleId,
        date: plan.date,
        km: t.plannedKm,
        litres: t.plannedFuelL,
      })),
    );

    const [published] = await tx
      .update(plans)
      .set({
        status: 'PUBLISHED',
        revision: 1,
        publishedAt: now,
        publishedById: actor.id,
        version: sql`${plans.version} + 1`,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(plans.id, plan.id), eq(plans.version, version)))
      .returning();
    if (!published) throw new VersionMismatchError('plan');

    const tripIds = carrying.map((t) => t.id).sort();
    const outletIds = [
      ...new Set([
        ...carrying.flatMap((t) =>
          (ctx.stopsByTrip.get(t.id) ?? []).map((s) => s.outletId),
        ),
        ...confirmed
          .map((d) => ctx.orders.get(d.orderId)?.outletId)
          .filter((o): o is string => Boolean(o)),
      ]),
    ].sort();
    await tx.insert(planRevisions).values({
      planId: plan.id,
      revision: 1,
      reasonCode: 'PUBLISH',
      changes: [],
      affectedTripIds: tripIds,
      affectedOutletIds: outletIds,
      createdById: actor.id,
    });
    await this.audit.record({
      action: PLANNING_AUDIT.planPublished,
      entity: ['plan', plan.id],
      before: { status: 'DRAFT', revision: 0 },
      after: {
        status: 'PUBLISHED',
        revision: 1,
        trips: tripIds.length,
        deferred: confirmed.length,
      },
    });
    await this.outbox.add(
      PLANNING_EVENTS.planPublished,
      {
        v: 1,
        planId: plan.id,
        depotId: plan.depotId,
        date: plan.date,
        revision: 1,
        tripIds,
      },
      { aggregate: ['plan', plan.id], depotId: plan.depotId, outletIds },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.planPublished,
        planId: plan.id,
        revision: 1,
        trips: tripIds.length,
      },
      'plan published',
    );
    return this.contexts.build(published);
  }

  contextFor(plan: PlanRow): Promise<PlanContext> {
    return this.contexts.build(plan);
  }

  /** The plan, locked for this transaction, in the actor's scope. */
  async lock(id: string, actor: Actor): Promise<PlanRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), this.scope.where(actor)))
      .for('update');
    return this.scope.found(row);
  }

  /** A DRAFT or PUBLISHED plan at the version the caller loaded (edits and revisions). */
  async loadEditable(
    id: string,
    version: number,
    actor: Actor,
  ): Promise<PlanContext> {
    const plan = await this.lock(id, actor);
    if (plan.status === 'CLOSED')
      throw new PlanLockedError('The plan is closed.');
    if (plan.version !== version) throw new VersionMismatchError('plan');
    return this.contexts.build(plan);
  }

  /** A DRAFT plan at the version the caller loaded, with its context. */
  async loadDraft(
    id: string,
    version: number,
    actor: Actor,
  ): Promise<PlanContext> {
    const plan = await this.lock(id, actor);
    if (plan.status === 'CLOSED')
      throw new PlanLockedError('The plan is closed.');
    if (plan.status !== 'DRAFT')
      // After publish the edit list is the one way to change it (a revision).
      throw new StateConflictError(
        'The plan is published; change it with an edit list and a reason.',
      );
    if (plan.version !== version) throw new VersionMismatchError('plan');
    return this.contexts.build(plan);
  }

  /** The plan's next version, checked so a concurrent write loses with 412. */
  async bump(plan: PlanRow): Promise<PlanRow> {
    const [row] = await this.txHost.tx
      .update(plans)
      .set({
        version: sql`${plans.version} + 1`,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(plans.id, plan.id), eq(plans.version, plan.version)))
      .returning();
    if (!row) throw new VersionMismatchError('plan');
    return row;
  }

  /**
   * Refuses what the edits broke: any hard violation (422 with a fixes link),
   * or a soft one with no reason code and override note (AC-PLN-14).
   */
  refuseIntroduced(
    ctx: PlanContext,
    introduced: readonly Violation[],
    input: { reasonCode?: string; overrideNote?: string },
  ): void {
    const fixes = {
      fixes: {
        href: `/api/v1/plans/${ctx.plan.id}/suggest-fixes`,
        method: 'POST',
      },
    };
    const hard = introduced.filter((v) => v.severity === 'HARD');
    if (hard.length)
      throw new RuleViolationError(
        hard.map((v) => ({ ...v })),
        hard[0]?.message,
        fixes,
      );
    const soft = introduced.filter((v) => v.severity === 'SOFT');
    if (soft.length && !(input.reasonCode && input.overrideNote))
      throw new RuleViolationError(
        soft.map((v) => ({ ...v })),
        'A soft rule needs a reason code and an override note.',
        fixes,
      );
  }

  /**
   * SET_DRIVER and SET_WAVE, by trip key, after the engine's edits are saved.
   * Returns the trips they changed.
   */
  private async applyMeta(
    plan: PlanRow,
    ops: readonly MetaOp[],
  ): Promise<string[]> {
    if (ops.length === 0) return [];
    const changed: string[] = [];
    const ctx = await this.contexts.build(plan);
    for (const op of ops) {
      const trip = ctx.tripsByKey.get(op.tripKey);
      if (trip) changed.push(trip.id);
      if (!trip)
        throw new ValidationError([
          {
            field: 'tripKey',
            code: 'unknown_trip',
            message: `${op.tripKey} is not on the plan`,
          },
        ]);
      if (op.op === 'SET_DRIVER') {
        if (op.driverId) await this.assertDriver(op.driverId, plan.depotId);
        await this.txHost.tx
          .update(trips)
          .set({
            driverId: op.driverId,
            version: sql`${trips.version} + 1`,
            updatedAt: this.clock.realNow(),
          })
          .where(eq(trips.id, trip.id));
      } else {
        if (op.waveId) await this.assertWave(op.waveId, plan.depotId);
        await this.txHost.tx
          .update(trips)
          .set({
            waveId: op.waveId,
            version: sql`${trips.version} + 1`,
            updatedAt: this.clock.realNow(),
          })
          .where(eq(trips.id, trip.id));
      }
    }
    return changed;
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

  private async assertWave(id: string, depotId: string): Promise<void> {
    const [row] = await this.txHost.tx
      .select({ id: depotWaves.id })
      .from(depotWaves)
      .where(and(eq(depotWaves.id, id), eq(depotWaves.depotId, depotId)));
    if (!row)
      throw new ValidationError([
        {
          field: 'waveId',
          code: 'unknown_wave',
          message: 'Not a wave of this depot',
        },
      ]);
  }
}
