import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../../../core/context/request-context';
import { StateConflictError } from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { EventPayload } from '../../../core/persistence/ports';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { loadCheckLines, orders } from '../../../db/schema';
import { type AuditSource, AuditService } from '../../audit';
import { TripLifecycleService } from '../../planning';
import { inDeviceOrder, type BatchResult } from '../domain/loader-event';
import { LOAD_AUDIT, LOAD_EVENTS, LOAD_REJECTIONS } from '../loading.constants';
import type { LoadLineCheckedEvent } from '../events/loading.events';
import {
  type LoadLineView,
  type LoadTripRow,
  LoadingQueries,
} from './loading.queries';

export type LoadLineRow = typeof loadCheckLines.$inferSelect;

/** What a line's audit row keeps: the fields a reviewer reads. */
const auditShape = (line: LoadLineRow | LoadLineView) => ({
  status: line.status,
  qtyExpected: line.qtyExpected,
  qtyLoaded: line.qtyLoaded,
  checkedByName: line.checkedByName,
  checkedByUserId: line.checkedByUserId,
  stopSeq: line.stopSeq,
  planRevision: line.planRevision,
});

/** One item of a check batch, however it arrived. */
export interface CheckInput {
  lineId: string;
  qtyLoaded: number;
  /** The name typed on the shared tablet; required (AC-LOD-04). */
  checkedByName: string;
  clientUuid: string;
  /** The device clock; the audit row's `occurredAt`. */
  checkedAt: Date;
  deviceSeq?: number | null;
  deviceId?: string | null;
  source?: AuditSource;
}

/**
 * Checking lines off a load list, and taking a check back (L2, AC-LOD-04 to
 * AC-LOD-06).
 *
 * Checks arrive in batches, because a loader working a crate taps several
 * rows before the tablet gets a moment to send them, and because the same
 * batch comes back through `POST /sync` after a spell with no signal. A batch
 * never fails as a whole over one bad item (specs/api-conventions.md, section
 * 3): each item is applied, or refused with a code, on its own.
 *
 * Three rules shape the service:
 *
 * - **The quantity must match.** A check says "all 12 cases are here". Fewer
 *   is a shortfall, and a shortfall is a flag for the dispatcher to decide,
 *   not a quietly smaller number on a list nobody reads again (AC-LOD-05).
 * - **The clientUuid is the idempotency key.** The unique index on
 *   `load_check_lines.clientUuid` is the authority, so a replayed tap writes
 *   nothing, audits nothing and reports itself as a duplicate (AC-LOD-06,
 *   AC-LOD-18).
 * - **The first check starts the trip.** `PLANNED → LOADING` through
 *   planning's `TripLifecycleService`, inside this transaction, so the trip's
 *   status and the tick on the list commit together (architecture rule 2).
 */
@Injectable()
export class LoadCheckService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly queries: LoadingQueries,
    private readonly lifecycle: TripLifecycleService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(LoadCheckService.name);
  }

  /**
   * A batch of checks against one trip. The trip is read through the scope
   * once, so a batch aimed at another depot's trip is 404 before any item is
   * looked at; after that every item stands or falls alone.
   */
  @Transactional()
  async checkMany(
    tripId: string,
    items: readonly CheckInput[],
    actor: Actor,
  ): Promise<{ trip: LoadTripRow; results: BatchResult[] }> {
    const trip = await this.queries.trip(tripId, actor);
    const results: BatchResult[] = [];
    for (const item of inDeviceOrder(items))
      results.push(await this.checkOne(trip, item, actor));
    // The trip's status may have moved under us on the first applied item.
    return { trip: await this.queries.trip(tripId, actor), results };
  }

  /**
   * One line checked. Returns the item's verdict rather than throwing, so one
   * refused crate does not undo the three the loader got right.
   */
  private async checkOne(
    trip: LoadTripRow,
    item: CheckInput,
    actor: Actor,
  ): Promise<BatchResult> {
    const replay = await this.replayOf(item.clientUuid);
    if (replay)
      return {
        clientUuid: item.clientUuid,
        status: 'duplicate',
        id: replay.id,
      };

    const [line] = await this.txHost.tx
      .select()
      .from(loadCheckLines)
      .where(eq(loadCheckLines.id, item.lineId))
      .for('update');
    if (!line || line.tripId !== trip.id)
      return this.rejected(
        item,
        LOAD_REJECTIONS.lineNotFound,
        'That line is not on this trip.',
      );

    if (
      trip.status === 'RELEASED' ||
      trip.status === 'IN_PROGRESS' ||
      trip.status === 'COMPLETED'
    )
      return this.rejected(
        item,
        LOAD_REJECTIONS.tripClosed,
        'This trip has left the dock; its list is closed.',
      );
    if (line.status !== 'PENDING')
      return this.rejected(
        item,
        LOAD_REJECTIONS.lineNotCheckable,
        line.status === 'FLAGGED'
          ? 'This line is flagged. Wait for the depot, then re-check it.'
          : `This line is already ${line.status.toLowerCase()}. Undo the check first.`,
      );
    if (item.qtyLoaded > line.qtyExpected)
      return this.rejected(
        item,
        LOAD_REJECTIONS.overExpected,
        `Only ${line.qtyExpected} were ordered for this item.`,
      );
    if (item.qtyLoaded < line.qtyExpected)
      return this.rejected(
        item,
        LOAD_REJECTIONS.shortWithoutFlag,
        `${line.qtyExpected - item.qtyLoaded} short. Raise a flag for the shortfall instead.`,
      );

    const [after] = await this.txHost.tx
      .update(loadCheckLines)
      .set({
        status: 'OK',
        qtyLoaded: item.qtyLoaded,
        checkedByUserId: actor.id,
        checkedByName: item.checkedByName,
        deviceId:
          item.deviceId ?? this.context.deviceId ?? actor.deviceId ?? null,
        clientUuid: item.clientUuid,
        checkedAt: item.checkedAt,
      })
      .where(eq(loadCheckLines.id, line.id))
      .returning();

    // The dock has started on this trip (AC-LOD-04). Only the first check
    // moves it; a trip already LOADING stays where it is.
    if (trip.status === 'PLANNED') {
      await this.lifecycle.markLoading(trip.id);
      trip.status = 'LOADING';
    }

    await this.audit.record({
      action: LOAD_AUDIT.lineChecked,
      entity: ['load_line', line.id],
      before: auditShape(line),
      after: auditShape(after),
      // The name typed on the tablet, not the account the tablet is signed
      // in as: on a shared dock only this says who looked in the crate.
      actorName: item.checkedByName,
      occurredAt: item.checkedAt,
      clientUuid: item.clientUuid,
      ...(item.source && { source: item.source }),
    });
    await this.emit(LOAD_EVENTS.lineChecked, trip, after);
    return { clientUuid: item.clientUuid, status: 'applied', id: after.id };
  }

  /**
   * A check taken back before the trip leaves (AC-LOD-06). Once the trip is
   * RELEASED the list is closed, and the line keeps what it said: 409, and no
   * line on the trip is offered an undo link.
   *
   * An undo of a line that is already PENDING changes nothing and writes
   * nothing — the second tap of a double tap, or an undo replayed from the
   * outbox after the first one landed.
   */
  @Transactional()
  async undo(
    lineId: string,
    actor: Actor,
    input: {
      checkedByName?: string | null;
      at?: Date;
      source?: AuditSource;
    } = {},
  ): Promise<LoadLineView> {
    const view = await this.queries.line(lineId, actor);
    const trip = await this.queries.trip(view.tripId, actor);
    if (trip.status !== 'PLANNED' && trip.status !== 'LOADING')
      throw new StateConflictError(
        `This trip is ${trip.status.toLowerCase().replace('_', ' ')}; its list can no longer be changed.`,
      );
    if (view.status === 'PENDING' && view.qtyLoaded == null) return view;
    if (view.status !== 'OK')
      throw new StateConflictError(
        view.status === 'FLAGGED'
          ? 'This line is flagged. Undo the flag instead.'
          : `A ${view.status.toLowerCase()} line cannot be unchecked.`,
      );

    const [after] = await this.txHost.tx
      .update(loadCheckLines)
      .set({
        status: 'PENDING',
        qtyLoaded: null,
        checkedByUserId: null,
        checkedByName: null,
        checkedAt: null,
        // `clientUuid` stays: it is the record that the check it came from
        // has been applied, so a replay of that tap is still a duplicate
        // rather than a second check.
      })
      .where(eq(loadCheckLines.id, lineId))
      .returning();

    await this.audit.record({
      action: LOAD_AUDIT.lineCheckUndone,
      entity: ['load_line', lineId],
      before: auditShape(view),
      after: auditShape(after),
      ...(input.checkedByName && { actorName: input.checkedByName }),
      ...(input.at && { occurredAt: input.at }),
      ...(input.source && { source: input.source }),
    });
    await this.emit(LOAD_EVENTS.lineCheckUndone, trip, after);
    return { ...view, ...after, flags: view.flags };
  }

  /**
   * The same clientUuid twice is the same tap twice: the tablet queued it,
   * sent it, lost the answer and sent it again. Nothing is written and
   * nothing is audited the second time (AC-LOD-06, AC-LOD-18).
   */
  private async replayOf(clientUuid: string): Promise<LoadLineRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(loadCheckLines)
      .where(eq(loadCheckLines.clientUuid, clientUuid));
    return row ?? null;
  }

  private rejected(
    item: CheckInput,
    code: string,
    message: string,
  ): BatchResult {
    return {
      clientUuid: item.clientUuid,
      status: 'rejected',
      code,
      message,
      id: item.lineId,
    };
  }

  private async emit(
    type: string,
    trip: LoadTripRow,
    line: LoadLineRow,
  ): Promise<void> {
    const outletId = await this.outletOf(line.orderId);
    const payload: LoadLineCheckedEvent = {
      v: 1,
      tripId: trip.id,
      loadLineId: line.id,
      orderId: line.orderId,
      outletId,
      status: line.status,
      qtyExpected: line.qtyExpected,
      qtyLoaded: line.qtyLoaded,
      stopSeq: line.stopSeq,
    };
    await this.outbox.add(type, payload as unknown as EventPayload, {
      aggregate: ['trip', trip.id],
      depotId: trip.depotId,
      outletIds: [outletId],
    });
  }

  /** The outlet the line's goods are going to, for the event's routing. */
  private async outletOf(orderId: string): Promise<string> {
    const [row] = await this.txHost.tx
      .select({ outletId: orders.outletId })
      .from(orders)
      .where(eq(orders.id, orderId));
    return row.outletId;
  }
}
