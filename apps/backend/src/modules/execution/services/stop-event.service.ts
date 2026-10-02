import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor, StopEventType } from '@waypoint/shared';
import { and, asc, eq, lt, ne } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  StateConflictError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { EventPayload } from '../../../core/persistence/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deliveryLines,
  orderLines,
  stopEvents,
  stops,
} from '../../../db/schema';
import { type AuditSource, AuditService } from '../../audit';
import { OrderLifecycleService } from '../../ordering';
import { TripLifecycleService } from '../../planning';
import { type FieldEvent, isLateSync, payloadOf } from '../domain/field-event';
import { assertProof, fieldError, outcomeOf } from '../domain/proof-rules';
import {
  EXECUTION_AUDIT,
  EXECUTION_EVENTS,
  EXECUTION_LOGS,
} from '../execution.constants';
import type { TripSummaryRow } from './my-trips.queries';
import { MyTripsQueries } from './my-trips.queries';
import type { StopView } from './stop.queries';
import { StopQueries } from './stop.queries';

export type StopEventRow = typeof stopEvents.$inferSelect;

export interface AppliedEvent {
  event: StopEventRow;
  /** True when this clientUuid had already been applied: a replay, not a change. */
  duplicate: boolean;
  tripId: string;
  stopId: string | null;
}

/** What `apply` is given: the event, and where it came from. */
export type ApplyInput = FieldEvent & { source?: AuditSource };

/**
 * The one handler for every field event, whichever way it arrived: an online
 * shortcut (`POST /stops/{id}/arrive`) or the same tap replayed from the
 * phone's outbox through `POST /sync`. One transaction holds all of it
 * (architecture rule 4), so a driver's tap is either wholly recorded or not
 * recorded at all:
 *
 * 1. a replay of a clientUuid already applied changes nothing and reports
 *    itself as a duplicate, which is what makes the offline outbox safe;
 * 2. the trip and stop are read through their scope, so another driver's
 *    trip is 404 before anything is checked (AC-EXE-02);
 * 3. the proof rules and the device's base version are checked, then the
 *    state machines inside `TripLifecycleService`, so a refused event leaves
 *    no row behind (AC-EXE-07, AC-EXE-10, AC-EXE-13);
 * 4. the event is appended — never edited, never deleted;
 * 5. it is projected onto the stop and trip (`TripLifecycleService`) and the
 *    order (`OrderLifecycleService`), and its delivery lines are written;
 * 6. the audit row and the outbox event go in the same transaction.
 */
@Injectable()
export class StopEventService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly trips: MyTripsQueries,
    private readonly stops: StopQueries,
    private readonly lifecycle: TripLifecycleService,
    private readonly orders: OrderLifecycleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(StopEventService.name);
  }

  @Transactional()
  async apply(input: ApplyInput, actor: Actor): Promise<AppliedEvent> {
    const replay = await this.replayOf(input.clientUuid);
    if (replay) return replay;

    const stop = input.stopId
      ? await this.stops.get(input.stopId, actor)
      : null;
    const tripId = stop?.tripId ?? input.tripId;
    if (!tripId) throw new NotFoundError('trip');
    const trip = await this.trips.get(tripId, actor);
    // A stop reached through another trip's id is not this trip's business.
    if (stop && input.tripId && stop.tripId !== input.tripId)
      throw new NotFoundError('stop');

    assertProof(input);
    this.assertStartable(input, trip);
    this.assertBaseVersion(
      input,
      stop?.version ?? trip.version,
      stop ? 'stop' : 'trip',
    );
    if (stop && trip.status !== 'IN_PROGRESS')
      throw new StateConflictError(
        `This stop belongs to a trip that is ${trip.status.toLowerCase().replace('_', ' ')}. Start the trip first.`,
      );

    const outOfSequence = stop ? await this.isOutOfSequence(stop) : false;
    const lines = stop ? await this.resolveLines(input, stop) : [];
    const unitsDelivered = lines.length
      ? lines.reduce((sum, line) => sum + line.qtyDelivered, 0)
      : null;

    const row = await this.append(input, trip, stop, actor);
    await this.project(input, trip, stop, lines, unitsDelivered);
    await this.recordAudit(input, row, trip, stop, unitsDelivered);
    await this.emit(input, trip, stop, unitsDelivered);

    this.log.info(
      {
        event: EXECUTION_LOGS.stopRecorded,
        tripId: trip.id,
        stopId: stop?.id ?? null,
        type: input.type,
        lateSync: row.lateSync,
      },
      'field event recorded',
    );
    if (outOfSequence && stop)
      this.log.info(
        {
          event: EXECUTION_LOGS.outOfSequence,
          tripId: trip.id,
          stopId: stop.id,
          seq: stop.seq,
        },
        'arrived out of sequence',
      );

    return {
      event: row,
      duplicate: false,
      tripId: trip.id,
      stopId: stop?.id ?? null,
    };
  }

  /**
   * The same clientUuid twice is the same tap twice: the phone queued it,
   * sent it, lost the answer and sent it again. The unique index on
   * `stop_events.clientUuid` is the idempotency key, so nothing is written
   * and nothing is audited the second time (specs/sync/spec.md).
   */
  private async replayOf(clientUuid: string): Promise<AppliedEvent | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(stopEvents)
      .where(eq(stopEvents.clientUuid, clientUuid));
    return row
      ? { event: row, duplicate: true, tripId: row.tripId, stopId: row.stopId }
      : null;
  }

  /** A chilled run reports the reefer temperature when it starts (D1). */
  private assertStartable(input: ApplyInput, trip: TripSummaryRow): void {
    if (input.type !== 'TRIP_STARTED') return;
    if (trip.tempClass === 'CHILLED' && input.reeferTempC == null)
      throw fieldError(
        'reeferTempC',
        'required',
        'Read the reefer temperature before you start',
      );
  }

  /**
   * The version the phone saw. Offline, a stale one means the dispatcher
   * changed the trip while the phone was away, which is a conflict for
   * `/sync` to resolve; online it means the screen is old.
   */
  private assertBaseVersion(
    input: ApplyInput,
    current: number,
    what: 'stop' | 'trip',
  ): void {
    if (input.baseVersion != null && input.baseVersion !== current)
      throw new VersionMismatchError(what);
  }

  /** An earlier stop of the same trip is still waiting (AC-EXE-08). */
  private async isOutOfSequence(stop: StopView): Promise<boolean> {
    if (stop.seq == null) return false;
    const earlier = await this.txHost.tx
      .select({ id: stops.id })
      .from(stops)
      .where(
        and(
          eq(stops.tripId, stop.tripId),
          lt(stops.seq, stop.seq),
          eq(stops.status, 'PENDING'),
        ),
      );
    return earlier.length > 0;
  }

  /**
   * The delivery lines, each checked against the stop's own order and given
   * the ordered quantity as `qtyExpected`, so the row says both what was
   * asked for and what arrived even after the order changes.
   */
  private async resolveLines(
    input: ApplyInput,
    stop: StopView,
  ): Promise<(typeof deliveryLines.$inferInsert)[]> {
    if (!input.lines?.length) return [];
    const ordered = await this.txHost.tx
      .select({ id: orderLines.id, qty: orderLines.qty })
      .from(orderLines)
      .where(eq(orderLines.orderId, stop.orderId));
    return input.lines.map((line) => {
      const match = ordered.find((o) => o.id === line.orderLineId);
      if (!match)
        throw fieldError(
          'lines',
          'invalid',
          "That item is not on this stop's order",
        );
      if (line.qtyDelivered > match.qty)
        throw fieldError(
          'lines',
          'max',
          `Only ${match.qty} were loaded for this item`,
        );
      return {
        stopId: stop.id,
        orderLineId: line.orderLineId,
        qtyExpected: match.qty,
        qtyDelivered: line.qtyDelivered,
        condition: line.condition,
        note: line.note ?? null,
      };
    });
  }

  /** The append-only row: the record everything else is a projection of. */
  private async append(
    input: ApplyInput,
    trip: TripSummaryRow,
    stop: StopView | null,
    actor: Actor,
  ): Promise<StopEventRow> {
    const now = this.clock.now();
    const [row] = await this.txHost.tx
      .insert(stopEvents)
      .values({
        clientUuid: input.clientUuid,
        tripId: trip.id,
        stopId: stop?.id ?? null,
        type: input.type,
        occurredAt: input.occurredAt,
        receivedAt: now,
        deviceSeq: input.deviceSeq ?? null,
        lateSync: isLateSync(input.occurredAt, now),
        deviceId: input.deviceId ?? null,
        actorId: actor.id,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        payload: payloadOf(input),
        appliedAt: now,
      })
      .returning();
    return row;
  }

  /** The projections: stop and trip through planning, order through ordering. */
  private async project(
    input: ApplyInput,
    trip: TripSummaryRow,
    stop: StopView | null,
    lines: (typeof deliveryLines.$inferInsert)[],
    unitsDelivered: number | null,
  ): Promise<void> {
    switch (input.type) {
      case 'TRIP_DOWNLOADED':
        await this.lifecycle.markDownloaded(trip.id, {
          at: input.occurredAt,
          bundleVersion: input.bundleVersion ?? trip.version,
        });
        return;
      case 'TRIP_STARTED': {
        await this.lifecycle.markStarted(trip.id, {
          at: input.occurredAt,
          reeferTempC: input.reeferTempC ?? null,
        });
        // The load leaves the depot with the trip (DEPART).
        for (const orderId of await this.orderIdsOf(trip.id))
          await this.orders.markInTransit(orderId);
        return;
      }
      case 'TRIP_COMPLETED':
        this.assertEveryStopRecorded(trip);
        await this.lifecycle.markCompleted(trip.id, { at: input.occurredAt });
        return;
      case 'CANT_RUN':
        if (trip.status !== 'RELEASED' && trip.status !== 'IN_PROGRESS')
          throw new StateConflictError(
            `A ${trip.status.toLowerCase().replace('_', ' ')} trip cannot be given up.`,
          );
        await this.lifecycle.markCantRun(trip.id, {
          reason: input.reasonCode!,
        });
        return;
      case 'ARRIVED':
        await this.lifecycle.markArrived(stop!.id, {
          at: input.occurredAt,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        });
        return;
      case 'DELIVERED':
      case 'PARTIAL':
      case 'FAILED': {
        const outcome = outcomeOf(input);
        await this.lifecycle.markStopOutcome(stop!.id, {
          outcome,
          at: input.occurredAt,
          receiverName: input.receiverName ?? null,
          note: input.note ?? null,
          unitsDelivered,
        });
        if (lines.length)
          await this.txHost.tx.insert(deliveryLines).values(lines);
        if (input.type === 'DELIVERED')
          await this.orders.markDelivered(stop!.orderId);
        else if (input.type === 'PARTIAL')
          await this.orders.markPartial(stop!.orderId);
        else await this.orders.markFailed(stop!.orderId);
        return;
      }
      case 'ISSUE_REPORTED':
        // The event is the record; receipt opens the issue thread from D5
        // through its own endpoint (ROO-48). Nothing to project here.
        return;
    }
  }

  /**
   * A trip ends when every stop has a result. An unfinished stop needs a
   * deferral reason from the dispatcher first, which is 19a's work, so the
   * driver cannot close the day over it (AC-EXE-15, AC-EXE-26).
   */
  private assertEveryStopRecorded(trip: TripSummaryRow): void {
    if (trip.openStops === 0) return;
    throw new StateConflictError(
      `${trip.openStops} ${trip.openStops === 1 ? 'stop has' : 'stops have'} no result yet. Record each one, or ask the depot to defer it.`,
    );
  }

  private async orderIdsOf(tripId: string): Promise<string[]> {
    const rows = await this.txHost.tx
      .select({ orderId: stops.orderId })
      .from(stops)
      .where(and(eq(stops.tripId, tripId), ne(stops.status, 'CANCELLED')))
      .orderBy(asc(stops.seq));
    return rows.map((row) => row.orderId);
  }

  private async recordAudit(
    input: ApplyInput,
    row: StopEventRow,
    trip: TripSummaryRow,
    stop: StopView | null,
    unitsDelivered: number | null,
  ): Promise<void> {
    const action = AUDIT_OF[input.type];
    if (!action) return;
    await this.audit.record({
      action,
      entity: stop ? ['stop', stop.id] : ['trip', trip.id],
      after: {
        type: input.type,
        ...(input.outcome && { outcome: input.outcome }),
        ...(input.note && { note: input.note }),
        ...(input.reasonCode && { reasonCode: input.reasonCode }),
        ...(unitsDelivered != null && { unitsDelivered }),
        lateSync: row.lateSync,
      },
      ...(input.reasonCode && { reasonCode: input.reasonCode }),
      ...(input.note && { reasonNote: input.note }),
      occurredAt: input.occurredAt,
      clientUuid: input.clientUuid,
      source: input.source ?? (row.lateSync ? 'OFFLINE_SYNC' : 'PWA'),
    });
  }

  private async emit(
    input: ApplyInput,
    trip: TripSummaryRow,
    stop: StopView | null,
    unitsDelivered: number | null,
  ): Promise<void> {
    const type = OUTBOX_OF[input.type];
    if (!type) return;
    const data: Record<string, unknown> = {
      v: 1,
      tripId: trip.id,
      ...(stop
        ? {
            stopId: stop.id,
            orderId: stop.orderId,
            outletId: stop.outletId,
            seq: stop.seq,
          }
        : {
            vehicleId: trip.vehicleId,
            depotId: trip.depotId,
          }),
    };
    if (input.type === 'DELIVERED' || input.type === 'PARTIAL')
      Object.assign(data, { outcome: outcomeOf(input), unitsDelivered });
    if (input.type === 'FAILED')
      Object.assign(data, { outcome: outcomeOf(input) });
    if (input.type === 'CANT_RUN')
      Object.assign(data, {
        driverId: trip.driverId,
        reason: input.reasonCode,
        startedAlready: trip.status === 'IN_PROGRESS',
      });
    if (input.type === 'TRIP_STARTED')
      Object.assign(data, {
        stops: trip.stops,
        reeferTempC: input.reeferTempC ?? null,
      });
    if (input.type === 'TRIP_DOWNLOADED')
      Object.assign(data, {
        bundleVersion: input.bundleVersion ?? trip.version,
        bundleHash: input.bundleHash ?? null,
      });

    await this.outbox.add(type, data as EventPayload, {
      aggregate: stop ? ['stop', stop.id] : ['trip', trip.id],
      depotId: trip.depotId,
      outletIds: stop ? [stop.outletId] : [],
    });
  }
}

/** The audit action each field event writes (specs/execution/spec.md). */
const AUDIT_OF: Record<StopEventType, string | null> = {
  TRIP_DOWNLOADED: EXECUTION_AUDIT.tripDownloaded,
  TRIP_STARTED: EXECUTION_AUDIT.tripStarted,
  ARRIVED: EXECUTION_AUDIT.stopArrived,
  DELIVERED: EXECUTION_AUDIT.stopCompleted,
  PARTIAL: EXECUTION_AUDIT.stopPartial,
  FAILED: EXECUTION_AUDIT.stopFailed,
  CANT_RUN: EXECUTION_AUDIT.tripCantRun,
  TRIP_COMPLETED: EXECUTION_AUDIT.tripCompleted,
  ISSUE_REPORTED: null,
};

/** The outbox event each field event emits; null means another module owns it. */
const OUTBOX_OF: Record<StopEventType, string | null> = {
  TRIP_DOWNLOADED: EXECUTION_EVENTS.tripDownloaded,
  TRIP_STARTED: EXECUTION_EVENTS.tripStarted,
  ARRIVED: EXECUTION_EVENTS.stopArrived,
  DELIVERED: EXECUTION_EVENTS.stopCompleted,
  PARTIAL: EXECUTION_EVENTS.stopCompleted,
  FAILED: EXECUTION_EVENTS.stopFailed,
  CANT_RUN: EXECUTION_EVENTS.tripCantRun,
  TRIP_COMPLETED: EXECUTION_EVENTS.tripCompleted,
  ISSUE_REPORTED: null,
};
