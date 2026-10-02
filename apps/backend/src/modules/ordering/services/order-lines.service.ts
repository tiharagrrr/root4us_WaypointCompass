import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  NotFoundError,
  StateConflictError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { orderLines } from '../../../db/schema';
import { AuditService } from '../../audit';
import { computeTotals } from '../domain/totals';
import type { OrderLinesChangedEvent } from '../events/ordering.events';
import type {
  OrderLineInputDto,
  SetOrderLinesDto,
  UpdateOrderLineDto,
} from '../dto/order.dto';
import { ORDER_AUDIT, ORDER_EVENTS } from '../ordering.constants';
import { OrderRules } from '../policies/order.rules';
import { OrderLinesValidator } from './order-lines.validator';
import type { OrderLineView, OrderView } from './order.view';
import { OrderViews } from './order.views';
import { OrdersService } from './orders.service';

/** The audit shape of a line set: what changed, not every column. */
const linesShape = (lines: readonly OrderLineView[]) =>
  lines
    .map((l) => ({ itemId: l.itemId, sku: l.sku, qty: l.qty }))
    .sort((a, b) => a.sku.localeCompare(b.sku));

/**
 * The lines of one order: M1's table, M1a's "Add item" and the quantity
 * stepper. Every write recomputes the order's totals and bumps its version in
 * the same transaction, and answers with the order, so M1 redraws its summary
 * card, its buttons and its ETag from one response (AC-ORD-13, AC-ORD-15).
 *
 * Each write needs `If-Match` with the order's version, so two tabs editing
 * one order cannot interleave quantities (AC-ORD-14).
 */
@Injectable()
export class OrderLinesService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly orders: OrdersService,
    private readonly rules: OrderRules,
    private readonly validator: OrderLinesValidator,
    private readonly views: OrderViews,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(OrderLinesService.name);
  }

  /** PUT: the whole line set at once, as applying a preset on M1 does. */
  @Transactional()
  async replace(
    orderId: string,
    dto: SetOrderLinesDto,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const before = await this.editable(orderId, actor, version);
    const snapshots = await this.validator.snapshot(dto.lines, before);

    await this.txHost.tx
      .delete(orderLines)
      .where(eq(orderLines.orderId, orderId));
    await this.txHost.tx
      .insert(orderLines)
      .values(snapshots.map((line) => ({ ...line, orderId })));

    return this.settle(before, version, 'replaced');
  }

  /** POST: one item added (M1a). A second line for the same item is refused. */
  @Transactional()
  async add(
    orderId: string,
    dto: OrderLineInputDto,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const before = await this.editable(orderId, actor, version);
    const [snapshot] = await this.validator.snapshot([dto], before, '');
    // One line per item (`order_lines_item_uq`): M1a shows the item already
    // on the order and its stepper, rather than adding a second row.
    if (before.lines?.some((l) => l.itemId === dto.itemId))
      throw new StateConflictError(
        'This item is already on the order. Change its quantity instead.',
      );
    await this.txHost.tx.insert(orderLines).values({ ...snapshot, orderId });

    return this.settle(before, version, 'added');
  }

  /** PATCH: the quantity stepper on M1 and M1a. */
  @Transactional()
  async setQty(
    orderId: string,
    lineId: string,
    dto: UpdateOrderLineDto,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const before = await this.editable(orderId, actor, version);
    const line = this.lineOf(before, lineId);
    if (line.qty !== dto.qty)
      await this.txHost.tx
        .update(orderLines)
        .set({ qty: dto.qty })
        .where(eq(orderLines.id, lineId));

    return this.settle(before, version, 'quantity changed');
  }

  /** DELETE: the line goes, and the response carries the new totals. */
  @Transactional()
  async remove(
    orderId: string,
    lineId: string,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const before = await this.editable(orderId, actor, version);
    this.lineOf(before, lineId);
    await this.txHost.tx
      .delete(orderLines)
      .where(and(eq(orderLines.id, lineId), eq(orderLines.orderId, orderId)));

    return this.settle(before, version, 'removed');
  }

  /** The order with its lines, refusing the write when it is no longer editable. */
  private async editable(
    orderId: string,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const order = await this.orders.loadForWrite(orderId, actor, version);
    if (!this.rules.canEdit(order, actor, this.clock.now()))
      throw this.orders.refuseEdit(order);
    return order;
  }

  private lineOf(order: OrderView, lineId: string): OrderLineView {
    const line = order.lines?.find((l) => l.id === lineId);
    if (!line) throw new NotFoundError('order line');
    return line;
  }

  /**
   * Recomputes the totals from the lines now in the database, bumps the
   * version, audits the change and answers with the order. The engine plans
   * on these totals, so they are derived here on every line change and never
   * sent by a client.
   */
  private async settle(
    before: OrderView,
    version: number,
    what: string,
  ): Promise<OrderView> {
    const lines = await this.views.linesOf(before.id);
    const totals = computeTotals(lines);
    const row = await this.orders.bump(before.id, version, {
      units: totals.units,
      weightKg: totals.weightKg,
      volumeM3: totals.volumeM3,
      valueLkr: totals.valueLkr,
    });

    await this.audit.record({
      action: ORDER_AUDIT.linesChanged,
      entity: ['order', before.id],
      before: {
        lines: linesShape(before.lines ?? []),
        units: before.units,
        weightKg: before.weightKg,
        volumeM3: before.volumeM3,
        version: before.version,
      },
      after: {
        lines: linesShape(lines),
        units: row.units,
        weightKg: row.weightKg,
        volumeM3: row.volumeM3,
        version: row.version,
      },
    });
    const event: OrderLinesChangedEvent = {
      v: 1,
      orderId: before.id,
      outletId: row.outletId,
      lines: totals.lines,
      units: totals.units,
    };
    await this.outbox.add(ORDER_EVENTS.linesChanged, event, {
      aggregate: ['order', before.id],
      depotId: row.depotId,
      outletIds: [row.outletId],
    });
    this.log.info(
      {
        event: ORDER_AUDIT.linesChanged,
        orderId: before.id,
        lines: totals.lines,
        units: totals.units,
      },
      `order lines ${what}`,
    );
    const view = await this.views.one(row);
    return { ...view, lines, totals };
  }
}
