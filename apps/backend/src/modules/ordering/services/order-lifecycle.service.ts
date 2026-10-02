import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { OrderEvent, OrderStatus } from '@waypoint/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { orders } from '../../../db/schema';
import { AuditService } from '../../audit';
import { nextOrderStatus } from '../domain/transitions';
import { ORDER_AUDIT } from '../ordering.constants';
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
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(OrderLifecycleService.name);
  }

  /** The cutoff passed: the day's orders are now the planning queue. */
  markConfirmed(id: string): Promise<OrderRow> {
    return this.move(id, 'CUTOFF', { confirmedAt: this.clock.now() });
  }

  /** Planning published a plan that carries this order. */
  markPlanned(id: string): Promise<OrderRow> {
    return this.move(id, 'PLAN');
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

  /** A deferral was reversed, or a failed stop goes back in the queue. */
  requeue(id: string): Promise<OrderRow> {
    return this.move(id, 'REQUEUE');
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
