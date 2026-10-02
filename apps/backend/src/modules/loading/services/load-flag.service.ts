import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  type Actor,
  type LoadFlagDecision,
  type LoadFlagReason,
  loadFlagMachine,
} from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { RequestContext } from '../../../core/context/request-context';
import {
  ForbiddenError,
  StateConflictError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { EventPayload } from '../../../core/persistence/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { loadCheckLines, loadFlags, orders, trips } from '../../../db/schema';
import { type AuditSource, AuditService } from '../../audit';
import { OrderLifecycleService } from '../../ordering';
import { DeferralService } from '../../planning';
import { fieldError, reasonRequired } from '../domain/errors';
import { statusAfterUndo } from '../domain/load-order';
import { LOAD_AUDIT, LOAD_EVENTS } from '../loading.constants';
import type {
  LoadFlagDecidedEvent,
  LoadFlagRaisedEvent,
  LoadFlagResolvedEvent,
} from '../events/loading.events';
import { LoadScope } from '../policies/load.scope';
import {
  type LoadFlagRow,
  type LoadTripRow,
  LoadingQueries,
} from './loading.queries';

type LoadLineRow = typeof loadCheckLines.$inferSelect;

/** What a flag's audit row keeps: the fields a reviewer reads. */
const auditShape = (flag: LoadFlagRow) => ({
  status: flag.status,
  reason: flag.reason,
  qtyAffected: flag.qtyAffected,
  note: flag.note,
  decision: flag.decision,
  decisionNote: flag.decisionNote,
  decidedById: flag.decidedById,
  raisedByName: flag.raisedByName,
});

export interface RaiseFlagInput {
  loadLineId: string;
  reason: LoadFlagReason;
  qtyAffected: number;
  note?: string | null;
  /** The name typed on the shared tablet; required (AC-LOD-07). */
  raisedByName: string;
  clientUuid: string;
  at?: Date;
  source?: AuditSource;
}

export interface DecideFlagInput {
  decision: LoadFlagDecision;
  /** Required on a REMOVE, which defers goods and tells the store why. */
  reasonCode?: string | null;
  note?: string | null;
}

export interface RecheckInput {
  qtyLoaded: number;
  checkedByName: string;
  clientUuid: string;
  at?: Date;
  source?: AuditSource;
}

/** What a decision caused outside loading, for the response and the event. */
export interface FlagDecision {
  flag: LoadFlagRow;
  deferralId: string | null;
  backorderId: string | null;
  /** The plan's revision after a REMOVE bumped it. */
  revision: number;
}

/**
 * The flag loop: a loader raises a problem (L3), can take it back while
 * nobody has answered (L3a), the dispatcher decides REPLACE or REMOVE (L3b),
 * and a REPLACE sends the loader back to re-pick and re-check (L3c).
 * AC-LOD-07 to AC-LOD-12.
 *
 * `loadFlagMachine` is the authority on what may happen next — OPEN →
 * AWAITING_RECHECK on REPLACE, OPEN → RESOLVED on REMOVE or UNDO,
 * AWAITING_RECHECK → RESOLVED on RECHECK — so a second dispatcher deciding
 * the same flag, or a loader undoing one that has already been answered, is a
 * 409 and nothing moves (AC-LOD-09, AC-LOD-10).
 *
 * A REMOVE is the one place loading reaches outside itself, and it does so
 * through the two services that own those tables (architecture rule 2):
 * planning's `DeferralService` records the partial deferral and bumps the
 * plan's revision, and ordering's `OrderLifecycleService` raises the
 * backorder for the quantity that stayed behind. All of it is one
 * transaction, so there is no state where the goods are off the vehicle but
 * nobody is owed them (AC-LOD-12).
 */
@Injectable()
export class LoadFlagService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly queries: LoadingQueries,
    private readonly scope: LoadScope,
    private readonly deferrals: DeferralService,
    private readonly orders: OrderLifecycleService,
    private readonly clock: ClockService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(LoadFlagService.name);
  }

  /**
   * L3: something is wrong with these goods. The line goes FLAGGED, so it
   * stops counting as loadable, and the depot's dispatchers are told through
   * `load.flag_raised` (which alerts turns into LOADER_SHORTFALL and
   * notifications pushes).
   */
  @Transactional()
  async raise(
    input: RaiseFlagInput,
    actor: Actor,
  ): Promise<{ flag: LoadFlagRow; duplicate: boolean }> {
    const replay = await this.replayOf(input.clientUuid);
    if (replay) return { flag: replay, duplicate: true };

    const line = await this.lineForWrite(input.loadLineId, actor);
    const trip = await this.queries.trip(line.tripId, actor);
    if (trip.status !== 'PLANNED' && trip.status !== 'LOADING')
      throw new StateConflictError(
        `This trip is ${trip.status.toLowerCase().replace('_', ' ')}; its list can no longer be flagged.`,
      );
    if (line.status === 'FLAGGED')
      throw new StateConflictError(
        'This line already carries a flag. Wait for the depot to decide it.',
      );
    if (line.status === 'REMOVED' || line.status === 'REPLACED')
      throw new StateConflictError(
        `A ${line.status.toLowerCase()} line cannot be flagged again.`,
      );
    if (input.qtyAffected > line.qtyExpected)
      throw fieldError(
        'qtyAffected',
        'max',
        `Only ${line.qtyExpected} were ordered for this item.`,
      );

    const at = input.at ?? this.clock.now();
    const [flag] = await this.txHost.tx
      .insert(loadFlags)
      .values({
        tripId: line.tripId,
        loadLineId: line.id,
        reason: input.reason,
        qtyAffected: input.qtyAffected,
        note: input.note ?? null,
        status: 'OPEN',
        raisedByName: input.raisedByName,
        raisedByUserId: actor.id,
        clientUuid: input.clientUuid,
        raisedAt: at,
      })
      .returning();
    await this.setLine(line.id, { status: 'FLAGGED' });

    await this.audit.record({
      action: LOAD_AUDIT.flagRaised,
      entity: ['load_flag', flag.id],
      after: auditShape(flag),
      // The spec's audit table requires a reason on a raise: missing,
      // damaged, wrong temperature or over capacity.
      reasonCode: input.reason,
      ...(input.note && { reasonNote: input.note }),
      actorName: input.raisedByName,
      occurredAt: at,
      clientUuid: input.clientUuid,
      ...(input.source && { source: input.source }),
    });
    await this.emitRaised(flag, trip, line);
    this.log.info(
      {
        event: LOAD_AUDIT.flagRaised,
        tripId: trip.id,
        flagId: flag.id,
        loadLineId: line.id,
        reason: flag.reason,
      },
      'load flag raised',
    );
    return { flag, duplicate: false };
  }

  /**
   * L3a's Undo: the loader found the crate after all. Allowed only to the
   * person who raised it, and only while nobody has decided it — once the
   * dispatcher has answered, the answer stands and the loader re-checks
   * (AC-LOD-09).
   */
  @Transactional()
  async undo(
    id: string,
    actor: Actor,
    input: { at?: Date; source?: AuditSource } = {},
  ): Promise<LoadFlagRow> {
    const before = await this.flagForWrite(id, actor);
    this.assertCan(before, 'UNDO');
    // A shared tablet signs in as itself, so this compares accounts, not
    // typed names: whoever is on the tablet that raised it may take it back.
    if (before.raisedByUserId && before.raisedByUserId !== actor.id)
      throw new ForbiddenError(
        'Only the loader who raised this flag can undo it.',
      );

    const at = input.at ?? this.clock.now();
    const after = await this.setFlag(id, {
      status: 'RESOLVED',
      resolvedAt: at,
      // No decision: an undone flag never had one, which is how 23 tells an
      // undo apart from a REMOVE that resolved the same way.
    });
    const line = await this.lineOf(before.loadLineId);
    await this.setLine(line.id, { status: statusAfterUndo(line.qtyLoaded) });

    await this.audit.record({
      action: LOAD_AUDIT.flagUndone,
      entity: ['load_flag', id],
      before: auditShape(before),
      after: auditShape(after),
      actorName: before.raisedByName,
      occurredAt: at,
      ...(input.source && { source: input.source }),
    });
    await this.emitResolved(after, 'UNDONE', null);
    return after;
  }

  /**
   * L3b: the dispatcher's answer. REPLACE sends the loader back for another
   * crate; REMOVE accepts that these goods are not travelling, which defers
   * part of the order, raises a backorder and bumps the plan's revision
   * (AC-LOD-10, AC-LOD-12).
   */
  @Transactional()
  async decide(
    id: string,
    input: DecideFlagInput,
    actor: Actor,
  ): Promise<FlagDecision> {
    const before = await this.flagForWrite(id, actor);
    this.assertCan(before, input.decision);
    if (input.decision === 'REMOVE' && !input.reasonCode)
      throw reasonRequired();

    const line = await this.lineOf(before.loadLineId);
    const trip = await this.queries.trip(before.tripId, actor);
    const at = this.clock.now();

    let deferralId: string | null = null;
    let backorderId: string | null = null;
    let revision = trip.planRevision;

    if (input.decision === 'REMOVE') {
      // Only the affected quantity stays behind: the cases that are in the
      // building still travel, and the store is owed the rest.
      const kept = line.qtyExpected - before.qtyAffected;
      const partial = await this.deferrals.deferPartially({
        orderId: line.orderId,
        tripId: trip.id,
        reasonCode: input.reasonCode!,
        note: input.note ?? null,
        detail: {
          loadFlagId: id,
          loadLineId: line.id,
          qtyAffected: before.qtyAffected,
          qtyExpected: line.qtyExpected,
          reason: before.reason,
        },
      });
      deferralId = partial.deferral.id;
      revision = partial.revision;
      if (line.orderLineId)
        backorderId = (
          await this.orders.createBackorder({
            parentOrderId: line.orderId,
            lines: [{ orderLineId: line.orderLineId, qty: before.qtyAffected }],
            deliveryDate: partial.toDate,
            note: input.note ?? null,
          })
        ).id;

      await this.setLine(line.id, {
        status: 'REMOVED',
        qtyLoaded: kept,
        checkedByUserId: actor.id,
        checkedAt: at,
        planRevision: revision,
      });
      // The removal is a plan change, so the whole list moves to the new
      // revision; otherwise release would refuse on a stale-line check that
      // the dock can do nothing about (AC-LOD-12).
      await this.txHost.tx
        .update(loadCheckLines)
        .set({ planRevision: revision })
        .where(eq(loadCheckLines.tripId, trip.id));
    }

    const after = await this.setFlag(id, {
      status: loadFlagMachine.next(before.status, input.decision)!,
      decision: input.decision,
      decisionNote: input.note ?? null,
      decidedById: actor.id,
      decidedAt: at,
      ...(input.decision === 'REMOVE' && { resolvedAt: at }),
    });

    await this.audit.record({
      action: LOAD_AUDIT.flagDecided,
      entity: ['load_flag', id],
      before: auditShape(before),
      after: { ...auditShape(after), deferralId, backorderId, revision },
      ...(input.reasonCode && { reasonCode: input.reasonCode }),
      ...(input.note && { reasonNote: input.note }),
      occurredAt: at,
    });
    await this.emitDecided(after, trip, line, {
      reasonCode: input.reasonCode ?? null,
      deferralId,
      backorderId,
      revision,
    });
    this.log.info(
      {
        event: LOAD_AUDIT.flagDecided,
        tripId: trip.id,
        flagId: id,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
        deferralId,
        backorderId,
        revision,
      },
      'load flag decided',
    );
    return { flag: after, deferralId, backorderId, revision };
  }

  /**
   * L3c: the loader re-picked and the replacement is on the vehicle. The
   * line goes REPLACED with what was actually loaded, and the flag closes
   * (AC-LOD-11). A flag nobody has decided cannot be re-checked: there is
   * nothing to have re-picked yet.
   */
  @Transactional()
  async recheck(
    id: string,
    input: RecheckInput,
    actor: Actor,
  ): Promise<LoadFlagRow> {
    const replay = await this.replayOf(input.clientUuid);
    if (replay) return replay;

    const before = await this.flagForWrite(id, actor);
    this.assertCan(before, 'RECHECK');
    const line = await this.lineOf(before.loadLineId);
    if (input.qtyLoaded > line.qtyExpected)
      throw fieldError(
        'qtyLoaded',
        'max',
        `Only ${line.qtyExpected} were ordered for this item.`,
      );

    const at = input.at ?? this.clock.now();
    const after = await this.setFlag(id, {
      status: 'RESOLVED',
      resolvedAt: at,
    });
    await this.setLine(line.id, {
      status: 'REPLACED',
      qtyLoaded: input.qtyLoaded,
      checkedByUserId: actor.id,
      checkedByName: input.checkedByName,
      deviceId: this.context.deviceId ?? actor.deviceId ?? null,
      checkedAt: at,
    });

    await this.audit.record({
      action: LOAD_AUDIT.flagRechecked,
      entity: ['load_flag', id],
      before: auditShape(before),
      after: { ...auditShape(after), qtyLoaded: input.qtyLoaded },
      actorName: input.checkedByName,
      occurredAt: at,
      clientUuid: input.clientUuid,
      ...(input.source && { source: input.source }),
    });
    await this.emitResolved(after, 'RECHECK', input.qtyLoaded);
    return after;
  }

  /**
   * The flag machine is the authority. Flags carry no version, so there is
   * no If-Match to be stale against: a second decision is a state conflict,
   * not a concurrency one (AC-LOD-10).
   */
  private assertCan(
    flag: LoadFlagRow,
    event: 'REPLACE' | 'REMOVE' | 'UNDO' | 'RECHECK',
  ): void {
    if (loadFlagMachine.can(flag.status, event)) return;
    throw new StateConflictError(
      flag.status === 'RESOLVED'
        ? 'This flag has already been resolved.'
        : flag.decision
          ? `This flag was already decided: ${flag.decision.toLowerCase()}.`
          : `A flag that is ${flag.status.toLowerCase().replace('_', ' ')} cannot take that.`,
    );
  }

  /** The flag within the actor's scope, locked for the decision. */
  private async flagForWrite(id: string, actor: Actor): Promise<LoadFlagRow> {
    // Read through the scope first, so another depot's flag is 404 before
    // anything is locked (architecture rule 5).
    await this.queries.flag(id, actor);
    const [row] = await this.txHost.tx
      .select()
      .from(loadFlags)
      .where(eq(loadFlags.id, id))
      .for('update');
    return this.scope.found(row);
  }

  private async lineForWrite(id: string, actor: Actor): Promise<LoadLineRow> {
    await this.queries.line(id, actor);
    return this.lineOf(id);
  }

  private async lineOf(id: string): Promise<LoadLineRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(loadCheckLines)
      .where(eq(loadCheckLines.id, id))
      .for('update');
    return row;
  }

  private async setFlag(
    id: string,
    values: Partial<typeof loadFlags.$inferInsert>,
  ): Promise<LoadFlagRow> {
    const [row] = await this.txHost.tx
      .update(loadFlags)
      .set(values)
      .where(eq(loadFlags.id, id))
      .returning();
    return row;
  }

  private async setLine(
    id: string,
    values: Partial<typeof loadCheckLines.$inferInsert>,
  ): Promise<void> {
    await this.txHost.tx
      .update(loadCheckLines)
      .set(values)
      .where(eq(loadCheckLines.id, id));
  }

  /** The same clientUuid twice is the same tap twice (AC-LOD-18). */
  private async replayOf(clientUuid: string): Promise<LoadFlagRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(loadFlags)
      .where(eq(loadFlags.clientUuid, clientUuid));
    return row ?? null;
  }

  private async emitRaised(
    flag: LoadFlagRow,
    trip: LoadTripRow,
    line: LoadLineRow,
  ): Promise<void> {
    const outletId = await this.outletOf(line.orderId);
    const payload: LoadFlagRaisedEvent = {
      v: 1,
      flagId: flag.id,
      tripId: trip.id,
      loadLineId: line.id,
      orderId: line.orderId,
      outletId,
      reason: flag.reason,
      qtyAffected: flag.qtyAffected,
      // Alerts reads this to decide whether a shortfall is critical: a trip
      // leaving within half an hour cannot wait for a queue.
      plannedDepartAt: trip.plannedDepartAt
        ? this.clock.toIso(trip.plannedDepartAt)
        : null,
    };
    await this.outbox.add(
      LOAD_EVENTS.flagRaised,
      payload as unknown as EventPayload,
      {
        aggregate: ['load_flag', flag.id],
        depotId: trip.depotId,
        outletIds: [outletId],
      },
    );
  }

  private async emitDecided(
    flag: LoadFlagRow,
    trip: LoadTripRow,
    line: LoadLineRow,
    extra: {
      reasonCode: string | null;
      deferralId: string | null;
      backorderId: string | null;
      revision: number;
    },
  ): Promise<void> {
    const outletId = await this.outletOf(line.orderId);
    const payload: LoadFlagDecidedEvent = {
      v: 1,
      flagId: flag.id,
      // The web invalidates ['load-list', tripId] on this event, so the trip
      // is on the payload and not only on the routing.
      tripId: trip.id,
      loadLineId: line.id,
      orderId: line.orderId,
      outletId,
      decision: flag.decision!,
      ...extra,
    };
    await this.outbox.add(
      LOAD_EVENTS.flagDecided,
      payload as unknown as EventPayload,
      {
        aggregate: ['load_flag', flag.id],
        depotId: trip.depotId,
        outletIds: [outletId],
      },
    );
  }

  private async emitResolved(
    flag: LoadFlagRow,
    how: 'RECHECK' | 'REMOVE' | 'UNDONE',
    qtyLoaded: number | null,
  ): Promise<void> {
    const line = await this.lineOf(flag.loadLineId);
    const outletId = await this.outletOf(line.orderId);
    const payload: LoadFlagResolvedEvent = {
      v: 1,
      flagId: flag.id,
      tripId: flag.tripId,
      loadLineId: flag.loadLineId,
      status: flag.status,
      how,
      qtyLoaded,
    };
    await this.outbox.add(
      LOAD_EVENTS.flagResolved,
      payload as unknown as EventPayload,
      {
        aggregate: ['load_flag', flag.id],
        depotId: await this.depotOf(flag.tripId),
        outletIds: [outletId],
      },
    );
  }

  private async outletOf(orderId: string): Promise<string> {
    const [row] = await this.txHost.tx
      .select({ outletId: orders.outletId })
      .from(orders)
      .where(eq(orders.id, orderId));
    return row.outletId;
  }

  private async depotOf(tripId: string): Promise<string> {
    const [row] = await this.txHost.tx
      .select({ depotId: trips.depotId })
      .from(trips)
      .where(eq(trips.id, tripId));
    return row.depotId;
  }
}
