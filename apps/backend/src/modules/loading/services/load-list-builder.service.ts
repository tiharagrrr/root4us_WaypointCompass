import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { LoadLineStatus } from '@waypoint/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { EventPayload } from '../../../core/persistence/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  loadCheckLines,
  loadEventReceipts,
  loadFlags,
  loadReleases,
  orderLines,
  orders,
  plans,
  stops,
  trips,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import { TripLifecycleService } from '../../planning';
import {
  type DeliveredEvent,
  parsePayload,
  planEventPayload,
  tripReassignedPayload,
} from '../domain/event-payloads';
import { loadOrder } from '../domain/load-order';
import {
  LOAD_AUDIT,
  LOAD_CONSUMES,
  LOAD_EVENTS,
  LOAD_LOGS,
} from '../loading.constants';
import type { LoadListUpdatedEvent } from '../events/loading.events';

/** What building or refreshing one trip's list changed. */
export interface BuiltList {
  tripId: string;
  revision: number;
  lines: number;
  added: number;
  /** Lines whose goods left this trip, marked removed. */
  removed: number;
  /** Checks kept because the line did not change (AC-LOD-13). */
  keptChecks: number;
  /** Checks dropped because the line's quantity changed under them. */
  resetChecks: number;
  /** True when the trip went back to LOADING because its vehicle changed. */
  reopened: boolean;
}

/** What one delivered event did, for the relay's log and for the tests. */
export interface HandledEvent {
  lists: BuiltList[];
  /** True when the receipts table had already seen this event id. */
  replayed: boolean;
}

const NOTHING: HandledEvent = { lists: [], replayed: false };

/** The quantity and place a line should hold, from the plan and the order. */
interface Wanted {
  key: string;
  orderId: string;
  orderLineId: string | null;
  stopSeq: number;
  qtyExpected: number;
}

/** A status that means the goods are settled and must not be reopened. */
const DECIDED: readonly LoadLineStatus[] = ['REPLACED'];

/**
 * The one way a plan becomes a load list.
 *
 * `handle` takes a single outbox row and does everything that row implies in
 * one transaction: the receipt that marks it handled, each trip's lines, the
 * audit rows and the `load.list_updated` events. Either all of it lands or
 * none of it does (architecture rule 4).
 *
 * **What it builds.** One line per order line of every stop on the trip, with
 * `stopSeq` copied from the stop so the list can be read last stop first
 * without joining planning's tables again, and `qtyExpected` from the order
 * line. An order with no lines gets one line carrying the order's own units,
 * which is what the dataset's older orders look like (AC-LOD-01).
 *
 * **What a refresh keeps.** A revision is not a rebuild. A line whose order,
 * item and quantity are unchanged keeps its status, its quantity loaded and
 * the name that checked it, so a loader who has already done stops 6 and 5
 * does not do them again because the dispatcher moved stop 3 (AC-LOD-13). A
 * line whose goods left the trip is marked REMOVED and stops counting against
 * release; a line whose quantity changed under the loader goes back to
 * PENDING, because a tick against 12 cases says nothing about 14.
 *
 * **How it is driven.** The module registers it on the `EventBus`, and the
 * outbox relay (ROO-24) calls it one row at a time, inside that row's
 * transaction, which is also exactly how the tests drive it.
 *
 * **Why the receipts table.** Delivery is at least once. A redelivered
 * `plan.published` would find every line already correct and change nothing,
 * but it would still emit `load.list_updated` and put the Plan updated banner
 * on a tablet for a plan that did not move. Only the event id can tell a
 * redelivery from a genuine re-publish, so it is recorded in the same
 * transaction as the work it covers (AC-LOD-01).
 */
@Injectable()
export class LoadListBuilder {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly lifecycle: TripLifecycleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(LoadListBuilder.name);
  }

  /** True when the builder reacts to this event type at all. */
  static consumes(type: string): boolean {
    return (Object.values(LOAD_CONSUMES) as string[]).includes(type);
  }

  @Transactional()
  async handle(event: DeliveredEvent): Promise<HandledEvent> {
    if (!LoadListBuilder.consumes(event.type)) return NOTHING;
    if (!(await this.claim(event))) {
      this.log.debug(
        {
          event: LOAD_LOGS.eventReplayed,
          eventId: event.id,
          type: event.type,
        },
        'event already handled',
      );
      return { ...NOTHING, replayed: true };
    }
    return event.type === LOAD_CONSUMES.tripReassigned
      ? this.onReassigned(event)
      : this.onPlanEvent(event);
  }

  /** plan.published and plan.revised: every trip the event names. */
  private async onPlanEvent(event: DeliveredEvent): Promise<HandledEvent> {
    const parsed = parsePayload(planEventPayload, event.payload);
    if (!parsed.ok) return this.unreadable(event, parsed.reason);

    const lists: BuiltList[] = [];
    for (const tripId of parsed.value.tripIds) {
      const built = await this.refresh(tripId, parsed.value.revision, {
        reasonCode: parsed.value.reasonCode ?? null,
        note: parsed.value.note ?? null,
        why: event.type,
      });
      if (built) lists.push(built);
    }
    return { lists, replayed: false };
  }

  /**
   * trip.reassigned: a trip that changed *vehicle* has to be loaded again, so
   * it goes back to LOADING, its release record goes, and its list is
   * refreshed. One that only changed driver keeps its list and its checks,
   * because the goods and the vehicle have not moved (AC-LOD-19).
   */
  private async onReassigned(event: DeliveredEvent): Promise<HandledEvent> {
    const parsed = parsePayload(tripReassignedPayload, event.payload);
    if (!parsed.ok) return this.unreadable(event, parsed.reason);
    const { tripId, vehicleId, vehicleChanged } = parsed.value;

    const trip = await this.tripOf(tripId);
    if (!trip) return NOTHING;
    const movedVehicle =
      vehicleChanged ?? (vehicleId != null && vehicleId !== trip.vehicleId);
    if (!movedVehicle) return NOTHING;

    let reopened = false;
    if (trip.status === 'RELEASED') {
      await this.txHost.tx
        .delete(loadReleases)
        .where(eq(loadReleases.tripId, tripId));
      await this.lifecycle.markReloading(tripId);
      reopened = true;
    }
    const built = await this.refresh(tripId, trip.planRevision, {
      reasonCode: parsed.value.reasonCode ?? null,
      note: null,
      why: event.type,
      reopened,
    });
    return { lists: built ? [built] : [], replayed: false };
  }

  /**
   * One trip's lines brought in line with its plan, at `revision`. Returns
   * null for a trip that is gone or cancelled, which a late redelivery can
   * still name.
   */
  private async refresh(
    tripId: string,
    revision: number,
    why: {
      reasonCode: string | null;
      note: string | null;
      why: string;
      reopened?: boolean;
    },
  ): Promise<BuiltList | null> {
    const trip = await this.tripOf(tripId);
    if (!trip || trip.status === 'CANCELLED') return null;

    const wanted = await this.wantedLines(tripId);
    const existing = await this.txHost.tx
      .select()
      .from(loadCheckLines)
      .where(eq(loadCheckLines.tripId, tripId))
      .for('update');
    const removedByFlag = await this.linesRemovedByFlag(tripId);

    const byKey = new Map(existing.map((line) => [keyOf(line), line]));
    const wantedKeys = new Set(wanted.map((line) => line.key));
    const before = {
      lines: existing.length,
      revision: existing.reduce((max, l) => Math.max(max, l.planRevision), 0),
    };

    let added = 0;
    let keptChecks = 0;
    let resetChecks = 0;
    const inserts: (typeof loadCheckLines.$inferInsert)[] = [];

    for (const line of wanted) {
      const current = byKey.get(line.key);
      if (!current) {
        added += 1;
        inserts.push({
          tripId,
          orderId: line.orderId,
          orderLineId: line.orderLineId,
          stopSeq: line.stopSeq,
          status: 'PENDING',
          qtyExpected: line.qtyExpected,
          planRevision: revision,
        });
        continue;
      }
      // A decided flag settled these goods; the quantity on the line is the
      // decision's, not the order's, so neither is reset here.
      const settled =
        removedByFlag.has(current.id) || DECIDED.includes(current.status);
      const quantityMoved = current.qtyExpected !== line.qtyExpected;
      const reset = quantityMoved && !settled && current.qtyLoaded != null;
      if (reset) resetChecks += 1;
      else if (current.qtyLoaded != null) keptChecks += 1;

      await this.txHost.tx
        .update(loadCheckLines)
        .set({
          stopSeq: line.stopSeq,
          planRevision: revision,
          ...(settled
            ? {}
            : {
                qtyExpected: line.qtyExpected,
                ...(reset
                  ? {
                      status: 'PENDING' as const,
                      qtyLoaded: null,
                      checkedByUserId: null,
                      checkedByName: null,
                      checkedAt: null,
                      clientUuid: null,
                    }
                  : {}),
                // A line whose goods came back to the trip after a revision
                // took them away is loadable again.
                ...(current.status === 'REMOVED' && !reset
                  ? { status: 'PENDING' as const }
                  : {}),
              }),
        })
        .where(eq(loadCheckLines.id, current.id));
    }
    if (inserts.length)
      await this.txHost.tx.insert(loadCheckLines).values(inserts);

    // Goods that left the trip: the line stays, as the record of what was
    // picked, and stops counting against release (AC-LOD-13).
    const orphans = existing.filter((line) => !wantedKeys.has(keyOf(line)));
    if (orphans.length)
      await this.txHost.tx
        .update(loadCheckLines)
        .set({ status: 'REMOVED', planRevision: revision })
        .where(
          inArray(
            loadCheckLines.id,
            orphans.map((line) => line.id),
          ),
        );

    const lines = wanted.length + orphans.length;
    const after = {
      revision,
      lines,
      added,
      removed: orphans.length,
      keptChecks,
      resetChecks,
    };
    await this.audit.record({
      action: LOAD_AUDIT.listBuilt,
      entity: ['trip', tripId],
      before,
      after: { ...after, because: why.why },
      ...(why.reasonCode && { reasonCode: why.reasonCode }),
      ...(why.note && { reasonNote: why.note }),
      source: 'SYSTEM',
    });

    const payload: LoadListUpdatedEvent = {
      v: 1,
      tripId,
      planId: trip.planId,
      depotId: trip.depotId,
      revision,
      lines,
      added,
      removed: orphans.length,
      keptChecks,
      reopened: Boolean(why.reopened),
      reasonCode: why.reasonCode,
    };
    await this.outbox.add(
      LOAD_EVENTS.listUpdated,
      payload as unknown as EventPayload,
      { aggregate: ['trip', tripId], depotId: trip.depotId },
    );

    this.log.info(
      {
        event: LOAD_LOGS.listBuilt,
        tripId,
        lines,
        revision,
        added,
        removed: orphans.length,
        keptChecks,
      },
      'load list built',
    );
    return { tripId, ...after, reopened: Boolean(why.reopened) };
  }

  /**
   * What the trip should be carrying: every order line of every live stop,
   * with the stop's seq copied on. The order is last stop first, so the ids
   * a fresh build inserts sort the way the list reads.
   */
  private async wantedLines(tripId: string): Promise<Wanted[]> {
    const live = await this.txHost.tx
      .select({
        orderId: stops.orderId,
        seq: stops.seq,
      })
      .from(stops)
      .where(and(eq(stops.tripId, tripId), sql`${stops.status} <> 'CANCELLED'`))
      .orderBy(asc(stops.seq));
    const sequenced = loadOrder(live);
    if (sequenced.length === 0) return [];

    const orderIds = sequenced.map((stop) => stop.orderId);
    const lines = await this.txHost.tx
      .select({
        id: orderLines.id,
        orderId: orderLines.orderId,
        qty: orderLines.qty,
      })
      .from(orderLines)
      .where(inArray(orderLines.orderId, orderIds));
    const units = new Map(
      (
        await this.txHost.tx
          .select({ id: orders.id, units: orders.units })
          .from(orders)
          .where(inArray(orders.id, orderIds))
      ).map((row) => [row.id, row.units]),
    );

    return sequenced.flatMap<Wanted>((stop) => {
      const own = lines.filter((line) => line.orderId === stop.orderId);
      if (own.length === 0)
        return [
          {
            key: `${stop.orderId}:`,
            orderId: stop.orderId,
            orderLineId: null,
            stopSeq: stop.seq!,
            qtyExpected: units.get(stop.orderId) ?? 0,
          },
        ];
      return own.map((line) => ({
        key: `${stop.orderId}:${line.id}`,
        orderId: stop.orderId,
        orderLineId: line.id,
        stopSeq: stop.seq!,
        qtyExpected: line.qty,
      }));
    });
  }

  /**
   * Lines a dispatcher's REMOVE settled. A refresh must not put those back
   * to PENDING: the goods are not in the building, and ordering already
   * holds a backorder for them (AC-LOD-12).
   */
  private async linesRemovedByFlag(tripId: string): Promise<Set<string>> {
    const rows = await this.txHost.tx
      .select({ loadLineId: loadFlags.loadLineId })
      .from(loadFlags)
      .where(
        and(eq(loadFlags.tripId, tripId), eq(loadFlags.decision, 'REMOVE')),
      );
    return new Set(rows.map((row) => row.loadLineId));
  }

  private async tripOf(tripId: string): Promise<{
    id: string;
    planId: string;
    depotId: string;
    vehicleId: string;
    status: string;
    planRevision: number;
  } | null> {
    const [row] = await this.txHost.tx
      .select({
        id: trips.id,
        planId: trips.planId,
        depotId: trips.depotId,
        vehicleId: trips.vehicleId,
        status: trips.status,
        planRevision: plans.revision,
      })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(eq(trips.id, tripId));
    return row ?? null;
  }

  /**
   * Records that this event id is being handled, or false when it already
   * was. The insert is the lock: a second delivery of the same row conflicts
   * and comes back empty, whichever worker is holding it.
   */
  private async claim(event: DeliveredEvent): Promise<boolean> {
    const [receipt] = await this.txHost.tx
      .insert(loadEventReceipts)
      .values({ eventId: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ eventId: loadEventReceipts.eventId });
    return Boolean(receipt);
  }

  /**
   * A payload that does not parse is logged and dropped. The receipt stays:
   * retrying it would only block the events behind it, and the log line is
   * the thing to act on.
   */
  private unreadable(event: DeliveredEvent, reason: string): HandledEvent {
    this.log.warn(
      {
        event: LOAD_LOGS.eventUnreadable,
        eventId: event.id,
        type: event.type,
        reason,
      },
      'event payload did not match its schema',
    );
    return NOTHING;
  }
}

/** A line's identity across revisions: its order and its order line. */
const keyOf = (line: { orderId: string; orderLineId: string | null }): string =>
  `${line.orderId}:${line.orderLineId ?? ''}`;
