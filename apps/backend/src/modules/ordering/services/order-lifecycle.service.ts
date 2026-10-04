import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { OrderEvent, OrderStatus } from '@waypoint/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  StateConflictError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { AuditService } from '../../audit';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { EventPayload } from '../../../core/persistence/ports';
import { orderLines, orders } from '../../../db/schema';
import { computeTotals } from '../domain/totals';
import { nextOrderStatus } from '../domain/transitions';
import { ORDER_AUDIT, ORDER_EVENTS } from '../ordering.constants';
import { OrderNumberService } from './order-number.service';
import type { OrderRow } from './order.view';

/** Columns a lifecycle move may touch beside `status`. */
type Extra = Partial<
  Pick<
    typeof orders.$inferInsert,
    | 'confirmedAt'
    | 'deferredCount'
    | 'lastDeferredAt'
    | 'activeStopId'
    | 'deliveryDate'
  >
>;

/**
 * The one way an order's status moves after it is sent (architecture rule 2).
 * Planning, loading, execution and receipt call these methods inside their
 * own transaction, so the status change, its audit row and the caller's own
 * write all commit together; the caller emits its own domain event
 * (`plan.published`, `trip.released`, ...), because the move is part of that
 * use case rather than one of its own.
 *
 * Every method checks `orderMachine` first, so a move the machine refuses
 * throws before anything is written and the caller's transaction rolls back
 * (AC-ORD-36). `@Transactional()` joins the caller's transaction rather than
 * opening one of its own.
 */
@Injectable()
export class OrderLifecycleService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly numbers: OrderNumberService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(OrderLifecycleService.name);
  }

  /** The cutoff passed: the day's orders are now the planning queue. */
  markConfirmed(id: string): Promise<OrderRow> {
    return this.move(id, 'CUTOFF', { confirmedAt: this.clock.now() });
  }

  /**
   * Planning published a plan that carries this order, on `stopId`, which
   * becomes its one live stop (`activeStopId`).
   */
  markPlanned(id: string, stopId?: string): Promise<OrderRow> {
    return this.move(id, 'PLAN', stopId ? { activeStopId: stopId } : {});
  }

  /** The order waits for a later run; `deliveryDate` moves with it. */
  async markDeferred(id: string, toDate?: string): Promise<OrderRow> {
    const before = await this.load(id);
    return this.move(id, 'DEFER', {
      deferredCount: before.deferredCount + 1,
      lastDeferredAt: this.clock.now(),
      ...(toDate && { deliveryDate: toDate }),
    });
  }

  /**
   * A deferral was reversed, a failed stop goes back in the queue, or a
   * revision took the order off every trip: either way it has no live stop.
   */
  requeue(id: string): Promise<OrderRow> {
    return this.move(id, 'REQUEUE', { activeStopId: null });
  }

  /**
   * A plan revision moved a PLANNED order to another trip: the status stays,
   * and the new stop becomes its one live stop (`activeStopId`).
   */
  @Transactional()
  async moveStop(id: string, stopId: string): Promise<OrderRow> {
    const before = await this.load(id);
    if (before.status !== 'PLANNED')
      throw new StateConflictError(
        `Order ${before.orderNo} is ${before.status}; only a planned order moves trips`,
      );
    const [row] = await this.txHost.tx
      .update(orders)
      .set({
        activeStopId: stopId,
        version: before.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(orders.id, id), eq(orders.version, before.version)))
      .returning();
    if (!row) throw new VersionMismatchError('order');
    await this.audit.record({
      action: ORDER_AUDIT.stopChanged,
      entity: ['order', id],
      before: { activeStopId: before.activeStopId, version: before.version },
      after: { activeStopId: stopId, version: row.version },
    });
    this.log.info(
      { event: ORDER_AUDIT.stopChanged, orderId: id, stopId },
      'order moved to another stop',
    );
    return row;
  }

  markLoaded(id: string): Promise<OrderRow> {
    return this.move(id, 'LOAD');
  }

  markInTransit(id: string): Promise<OrderRow> {
    return this.move(id, 'DEPART');
  }

  markDelivered(id: string): Promise<OrderRow> {
    return this.move(id, 'DELIVER');
  }

  markPartial(id: string): Promise<OrderRow> {
    return this.move(id, 'PARTIAL');
  }

  markFailed(id: string): Promise<OrderRow> {
    return this.move(id, 'FAIL');
  }

  markReceived(id: string): Promise<OrderRow> {
    return this.move(id, 'RECEIVE');
  }

  markIssueReported(id: string): Promise<OrderRow> {
    return this.move(id, 'REPORT');
  }

  /**
   * A backorder for goods that did not travel (AC-LOD-12). The dispatcher
   * decided REMOVE at the dock, so part of an order is staying behind;
   * planning records the partial deferral and this records what the store is
   * still owed, as a new order of its own with `parentOrderId` pointing at
   * the one it came from and `source` backorder.
   *
   * It is CONFIRMED, not DRAFT: nobody has to place it, the store already
   * ordered these goods and the next plan should carry them. The item's
   * weight and value are copied from the parent's line, so the engine plans
   * the backorder on the same numbers even after the catalog changes.
   *
   * Runs inside loading's transaction (architecture rule 2: only ordering
   * writes `orders`).
   */
  @Transactional()
  async createBackorder(input: {
    parentOrderId: string;
    /** The quantity still owed, per line of the parent order. */
    lines: readonly { orderLineId: string; qty: number }[];
    /** The date the deferral moved the goods to. */
    deliveryDate: string;
    note?: string | null;
  }): Promise<OrderRow> {
    const parent = await this.load(input.parentOrderId);
    const wanted = new Map(input.lines.map((l) => [l.orderLineId, l.qty]));
    const parentLines = await this.txHost.tx
      .select()
      .from(orderLines)
      .where(inArray(orderLines.id, [...wanted.keys()]));

    const snapshots = parentLines.map((line) => ({
      itemId: line.itemId,
      qty: wanted.get(line.id)!,
      unitWeightKg: line.unitWeightKg,
      unitVolumeM3: line.unitVolumeM3,
      unitValueLkr: line.unitValueLkr,
    }));
    if (snapshots.length === 0) throw new NotFoundError('order line');
    const totals = computeTotals(snapshots);

    const [row] = await this.txHost.tx
      .insert(orders)
      .values({
        orderNo: await this.numbers.next(parent.brand),
        outletId: parent.outletId,
        depotId: parent.depotId,
        brand: parent.brand,
        districtId: parent.districtId,
        tempClass: parent.tempClass,
        requestedDate: input.deliveryDate,
        deliveryDate: input.deliveryDate,
        status: 'CONFIRMED',
        confirmedAt: this.clock.now(),
        afterCutoff: false,
        units: totals.units,
        weightKg: totals.weightKg,
        volumeM3: totals.volumeM3,
        valueLkr: totals.valueLkr,
        source: 'backorder',
        parentOrderId: parent.id,
        note: input.note ?? null,
      })
      .returning();
    await this.txHost.tx
      .insert(orderLines)
      .values(snapshots.map((line) => ({ ...line, orderId: row.id })));

    await this.audit.record({
      action: ORDER_AUDIT.backordered,
      entity: ['order', row.id],
      before: { backorderOf: parent.orderNo },
      after: {
        status: row.status,
        parentOrderId: row.parentOrderId,
        deliveryDate: row.deliveryDate,
        units: row.units,
        source: row.source,
      },
      ...(input.note && { reasonNote: input.note }),
    });
    await this.outbox.add(
      ORDER_EVENTS.backordered,
      {
        v: 1,
        orderId: row.id,
        orderNo: row.orderNo,
        parentOrderId: parent.id,
        parentOrderNo: parent.orderNo,
        outletId: row.outletId,
        deliveryDate: row.deliveryDate,
        units: row.units,
      } satisfies EventPayload,
      {
        aggregate: ['order', row.id],
        depotId: row.depotId,
        outletIds: [row.outletId],
      },
    );
    this.log.info(
      {
        event: ORDER_AUDIT.backordered,
        orderId: row.id,
        parentOrderId: parent.id,
        units: row.units,
      },
      'backorder raised for goods that stayed behind',
    );
    return row;
  }

  /** The same move for a set of orders, as publishing a plan makes. */
  @Transactional()
  async markManyPlanned(ids: readonly string[]): Promise<OrderRow[]> {
    const rows: OrderRow[] = [];
    for (const id of ids) rows.push(await this.markPlanned(id));
    return rows;
  }

  /** Which of these orders are in a status, for a caller's own checks. */
  async statusesOf(ids: readonly string[]): Promise<Map<string, OrderStatus>> {
    if (ids.length === 0) return new Map();
    const rows = await this.txHost.tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(inArray(orders.id, [...ids]));
    return new Map(rows.map((r) => [r.id, r.status]));
  }

  /**
   * One status move: check the machine, write, audit. No scope is applied,
   * because the caller already holds the row within its own scope; the status
   * table is what protects the order here.
   */
  @Transactional()
  private async move(
    id: string,
    event: OrderEvent,
    extra: Extra = {},
  ): Promise<OrderRow> {
    const before = await this.load(id);
    const status = nextOrderStatus(before.status, event);

    const [row] = await this.txHost.tx
      .update(orders)
      .set({
        status,
        ...extra,
        version: before.version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(orders.id, id), eq(orders.version, before.version)))
      .returning();
    if (!row) throw new VersionMismatchError('order');

    await this.audit.record({
      action:
        event === 'CUTOFF' ? ORDER_AUDIT.confirmed : ORDER_AUDIT.statusChanged,
      entity: ['order', id],
      before: { status: before.status, version: before.version },
      after: { status: row.status, version: row.version },
    });
    this.log.info(
      {
        event: ORDER_AUDIT.statusChanged,
        orderId: id,
        from: before.status,
        to: row.status,
      },
      'order status changed',
    );
    return row;
  }

  private async load(id: string): Promise<OrderRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .for('update');
    if (!row) throw new NotFoundError('order');
    return row;
  }
}
