import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  type Actor,
  type OrderStatus,
  orderMachine,
  type TempClass,
  WEEKDAYS,
  weekdayOf,
} from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { RequestContext } from '../../../core/context/request-context';
import {
  CutoffPassedError,
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { orderLines, orders } from '../../../db/schema';
import { AuditService } from '../../audit';
import { type OutletRow, OutletQueries } from '../../master-data';
import { DuplicateOrderError, fieldError } from '../domain/errors';
import { nextOrderStatus } from '../domain/transitions';
import { computeTotals } from '../domain/totals';
import type {
  CancelOrderDto,
  CreateOrderDto,
  SetOrderPriorityDto,
  UpdateOrderDto,
} from '../dto/order.dto';
import type {
  OrderCancelledEvent,
  OrderDraftEvent,
  OrderPriorityChangedEvent,
  OrderRolledEvent,
  OrderSubmittedEvent,
} from '../events/ordering.events';
import {
  ORDER_AUDIT,
  ORDER_EVENTS,
  ORDER_NOTICES,
  type OrderSource,
} from '../ordering.constants';
import { OrderRules } from '../policies/order.rules';
import { OrderScope } from '../policies/order.scope';
import { CutoffService } from './cutoff.service';
import { OrderNumberService } from './order-number.service';
import {
  OrderLinesValidator,
  type SnapshottedLine,
} from './order-lines.validator';
import { OrderQueries } from './order.queries';
import type { OrderRow, OrderView } from './order.view';
import { OrderViews } from './order.views';
import { TemplatesService } from './templates.service';

/** What an order's audit row keeps: the fields a reviewer reads, not the whole row. */
const auditShape = (o: OrderRow) => ({
  status: o.status,
  requestedDate: o.requestedDate,
  deliveryDate: o.deliveryDate,
  afterCutoff: o.afterCutoff,
  urgent: o.urgent,
  units: o.units,
  weightKg: o.weightKg,
  volumeM3: o.volumeM3,
  valueLkr: o.valueLkr,
  note: o.note,
  version: o.version,
});

/**
 * Every change a store manager or dispatcher makes to an order (M1, M1b, M2,
 * M8, 03). Each method is one use case in one transaction that holds the
 * write, its audit row and its outbox event, so none of the three can exist
 * without the others (architecture rule 4).
 *
 * The rules a command enforces, and where they come from:
 * - one non-cancelled order per outlet, requested date and class (AC-ORD-04);
 * - only Fresh outlets place chilled orders (AC-ORD-11);
 * - a Style outlet orders for its weekly delivery day, and that day is the
 *   run the order goes on, so a not-due Style order never reaches planning
 *   (AC-ORD-08, AC-ORD-37);
 * - a submit after the cutoff rolls to the next run with a notice (AC-ORD-02);
 * - edits and a store's cancel lock at the cutoff (AC-ORD-03, AC-ORD-20).
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: OrderScope,
    private readonly rules: OrderRules,
    private readonly clock: ClockService,
    private readonly context: RequestContext,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly outlets: OutletQueries,
    private readonly queries: OrderQueries,
    private readonly views: OrderViews,
    private readonly cutoff: CutoffService,
    private readonly numbers: OrderNumberService,
    private readonly validator: OrderLinesValidator,
    private readonly templates: TemplatesService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(OrdersService.name);
  }

  /**
   * M1: a draft for one class and date. The outlet, depot, brand and district
   * come from the actor's scope, never the body, so a store manager can only
   * order for their own outlet (AC-ORD-09, AC-ORD-10).
   */
  @Transactional()
  async createDraft(dto: CreateOrderDto, actor: Actor): Promise<OrderView> {
    const outlet = await this.ownOutlet(actor);
    this.checkClass(dto.tempClass, outlet);
    const requestedDate = this.checkRequestedDate(dto.requestedDate, outlet);
    await this.refuseDuplicate({
      outletId: outlet.id,
      requestedDate,
      tempClass: dto.tempClass,
    });

    const template = dto.templateId
      ? await this.templates.forOrder(dto.templateId, outlet.id, dto.tempClass)
      : undefined;
    const lines = await this.validator.snapshot(
      dto.lines ?? template?.lines ?? [],
      { brand: outlet.brand, tempClass: dto.tempClass },
    );

    const row = await this.insert({
      outlet,
      tempClass: dto.tempClass,
      requestedDate,
      deliveryDate: requestedDate,
      note: dto.note ?? null,
      templateId: template?.id ?? null,
      source: 'web',
      lines,
      actor,
    });

    await this.audit.record({
      action: ORDER_AUDIT.created,
      entity: ['order', row.id],
      after: auditShape(row),
    });
    await this.emit(ORDER_EVENTS.created, row, draftEvent(row));
    this.log.info(
      {
        event: ORDER_AUDIT.created,
        orderId: row.id,
        outletId: row.outletId,
        tempClass: row.tempClass,
        lines: lines.length,
      },
      'order created',
    );
    return this.views.withLines(row);
  }

  /** PATCH /orders/{id}: the note and the day asked for, while still editable. */
  @Transactional()
  async updateDraft(
    id: string,
    dto: UpdateOrderDto,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const before = await this.loadForWrite(id, actor, version);
    if (!this.rules.canEdit(before, actor, this.clock.now()))
      throw this.refusalFor(before, 'edit');

    const changes: Partial<typeof orders.$inferInsert> = {};
    if (dto.note !== undefined) changes.note = dto.note;
    if (dto.requestedDate && dto.requestedDate !== before.requestedDate) {
      const outlet = await this.outletOf(before);
      const requestedDate = this.checkRequestedDate(dto.requestedDate, outlet);
      await this.refuseDuplicate(
        {
          outletId: before.outletId,
          requestedDate,
          tempClass: before.tempClass,
        },
        before.id,
      );
      changes.requestedDate = requestedDate;
      // The run follows the day asked for, unless the order already rolled.
      if (!before.afterCutoff) changes.deliveryDate = requestedDate;
    }
    if (Object.keys(changes).length === 0) return before;

    const row = await this.bump(id, version, changes);
    await this.audit.record({
      action: ORDER_AUDIT.updated,
      entity: ['order', id],
      before: auditShape(before),
      after: auditShape(row),
    });
    await this.emit(ORDER_EVENTS.updated, row, draftEvent(row));
    this.log.info(
      { event: ORDER_AUDIT.updated, orderId: id, fields: Object.keys(changes) },
      'order updated',
    );
    return this.views.withLines(row);
  }

  /**
   * M1's Send. A submit at or after the cutoff still succeeds, but the order
   * moves to the next run and the response carries the notice M2 shows
   * (AC-ORD-01, AC-ORD-02).
   */
  @Transactional()
  async submit(id: string, actor: Actor, version: number): Promise<OrderView> {
    const before = await this.loadForWrite(id, actor, version);
    if (!this.rules.canSubmit(before, actor))
      throw this.refusalFor(before, 'submit');
    nextOrderStatus(before.status, 'SUBMIT');
    if (before.totals.lines === 0)
      throw fieldError('lines', 'min', 'Add at least one item');

    const now = this.clock.now();
    const late = now.getTime() >= before.editableUntil.getTime();
    const outlet = await this.outletOf(before);
    const deliveryDate = late
      ? await this.cutoff.nextRun(before.deliveryDate, {
          brand: before.brand,
          styleDeliveryDow: outlet.styleDeliveryDow,
        })
      : before.deliveryDate;

    const row = await this.bump(id, version, {
      status: 'SUBMITTED',
      submittedAt: now,
      afterCutoff: late,
      deliveryDate,
    });

    await this.audit.record({
      action: ORDER_AUDIT.submitted,
      entity: ['order', id],
      before: auditShape(before),
      after: auditShape(row),
    });
    await this.emit(ORDER_EVENTS.submitted, row, {
      v: 1,
      orderId: id,
      outletId: row.outletId,
      afterCutoff: row.afterCutoff,
      deliveryDate: row.deliveryDate,
    } satisfies OrderSubmittedEvent);

    if (late) {
      await this.emit(ORDER_EVENTS.rolledToNextRun, row, {
        v: 1,
        orderId: id,
        outletId: row.outletId,
        requestedDate: row.requestedDate,
        deliveryDate: row.deliveryDate,
        reason: 'AFTER_CUTOFF',
      } satisfies OrderRolledEvent);
      this.context.addNotice({
        code: ORDER_NOTICES.rolledToNextRun,
        message: `Sent after ${this.clock.toIso(before.editableUntil).slice(11, 16)}, so it goes on ${weekdayOf(deliveryDate)}'s run (${deliveryDate}).`,
      });
    }
    this.log.info(
      {
        event: ORDER_AUDIT.submitted,
        orderId: id,
        outletId: row.outletId,
        afterCutoff: late,
        deliveryDate,
      },
      'order submitted',
    );
    return this.views.withLines(row);
  }

  /**
   * A store manager cancels with a note of their own before the cutoff; a
   * dispatcher cancels with a reason code until the order is planned
   * (AC-ORD-19, AC-ORD-20, AC-ORD-21).
   */
  @Transactional()
  async cancel(
    id: string,
    dto: CancelOrderDto,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const before = await this.loadForWrite(id, actor, version);
    const byStore = actor.role === 'store_manager';
    if (byStore && !dto.reasonNote)
      throw fieldError(
        'reasonNote',
        'required',
        'Tell the depot why you are cancelling',
      );
    if (!byStore && !dto.reasonCode)
      throw fieldError('reasonCode', 'required', 'A reason is required');

    nextOrderStatus(before.status, 'CANCEL');
    if (!this.rules.canCancel(before, actor, this.clock.now()))
      throw this.refusalFor(before, 'cancel');

    const reason = byStore ? dto.reasonNote! : dto.reasonCode!;
    const row = await this.bump(id, version, {
      status: 'CANCELLED',
      cancelledAt: this.clock.now(),
      cancelReason: reason,
    });

    await this.audit.record({
      action: ORDER_AUDIT.cancelled,
      entity: ['order', id],
      before: auditShape(before),
      after: auditShape(row),
      ...(byStore
        ? { reasonNote: dto.reasonNote }
        : { reasonCode: dto.reasonCode }),
    });
    await this.emit(ORDER_EVENTS.cancelled, row, {
      v: 1,
      orderId: id,
      outletId: row.outletId,
      deliveryDate: row.deliveryDate,
      cancelledBy: byStore ? 'store' : 'dispatcher',
      reasonCode: byStore ? null : (dto.reasonCode ?? null),
    } satisfies OrderCancelledEvent);
    this.log.info(
      {
        event: ORDER_AUDIT.cancelled,
        orderId: id,
        outletId: row.outletId,
        by: byStore ? 'store' : 'dispatcher',
      },
      'order cancelled',
    );
    return this.views.withLines(row);
  }

  /** DELETE /orders/{id}: a draft goes; anything sent is cancelled instead. */
  @Transactional()
  async remove(id: string, actor: Actor, version: number): Promise<void> {
    const before = await this.loadForWrite(id, actor, version);
    if (!this.rules.canDelete(before, actor))
      throw new StateConflictError(
        'Only a draft can be deleted. Cancel the order instead.',
      );

    // A draft was never sent anywhere, so it leaves no business record
    // behind; its lines go with it (order_lines cascades).
    await this.txHost.tx.delete(orders).where(eq(orders.id, id));
    await this.audit.record({
      action: ORDER_AUDIT.deleted,
      entity: ['order', id],
      before: auditShape(before),
    });
    await this.emit(ORDER_EVENTS.deleted, before, draftEvent(before));
    this.log.info(
      { event: ORDER_AUDIT.deleted, orderId: id, outletId: before.outletId },
      'draft order deleted',
    );
  }

  /**
   * M8's Order again: a fresh draft for the next date still open, holding the
   * items that are still in the catalog with their original quantities. The
   * order it came from is untouched, and a notice names anything left out
   * (AC-ORD-07).
   */
  @Transactional()
  async reorder(id: string, actor: Actor): Promise<OrderView> {
    const source = await this.loadForWrite(id, actor);
    if (!this.rules.canReorder(source, actor))
      throw this.refusalFor(source, 'reorder');

    const outlet = await this.outletOf(source);
    const lines = await this.views.linesOf(source.id);
    const catalog = await this.validator.classify(
      lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      { brand: source.brand, tempClass: source.tempClass },
    );
    if (catalog.kept.length === 0)
      throw new StateConflictError(
        'None of this order’s items are in the catalog any more. Start a new order.',
      );

    const requestedDate = await this.cutoff.nextOpenDate(
      source.depotId,
      { brand: source.brand, styleDeliveryDow: outlet.styleDeliveryDow },
      this.clock.now(),
    );
    await this.refuseDuplicate({
      outletId: source.outletId,
      requestedDate,
      tempClass: source.tempClass,
    });

    const row = await this.insert({
      outlet,
      tempClass: source.tempClass,
      requestedDate,
      deliveryDate: requestedDate,
      note: null,
      templateId: null,
      source: 'reorder',
      lines: catalog.kept,
      actor,
    });

    await this.audit.record({
      action: ORDER_AUDIT.reordered,
      entity: ['order', row.id],
      before: { reorderedFrom: source.orderNo },
      after: auditShape(row),
    });
    await this.emit(ORDER_EVENTS.created, row, draftEvent(row));

    if (catalog.droppedNames.length)
      this.context.addNotice({
        code: ORDER_NOTICES.itemsLeftOut,
        message: `Left out, no longer in the catalog: ${catalog.droppedNames.join(', ')}.`,
      });
    this.log.info(
      {
        event: ORDER_AUDIT.reordered,
        orderId: row.id,
        fromOrderId: source.id,
        kept: catalog.kept.length,
        dropped: catalog.droppedNames.length,
      },
      'order reordered',
    );
    return this.views.withLines(row);
  }

  /** 03: the dispatcher's urgent flag, for example after a priority request. */
  @Transactional()
  async setPriority(
    id: string,
    dto: SetOrderPriorityDto,
    actor: Actor,
    version: number,
  ): Promise<OrderView> {
    const before = await this.loadForWrite(id, actor, version);
    if (!this.rules.canSetPriority(before, actor))
      throw new StateConflictError(
        'This order can no longer be marked urgent: it is already on its way.',
      );
    if (before.urgent === dto.urgent) return before;

    const row = await this.bump(id, version, { urgent: dto.urgent });
    await this.audit.record({
      action: ORDER_AUDIT.priorityChanged,
      entity: ['order', id],
      before: auditShape(before),
      after: auditShape(row),
    });
    await this.emit(ORDER_EVENTS.priorityChanged, row, {
      v: 1,
      orderId: id,
      outletId: row.outletId,
      deliveryDate: row.deliveryDate,
      urgent: row.urgent,
    } satisfies OrderPriorityChangedEvent);
    this.log.info(
      { event: ORDER_AUDIT.priorityChanged, orderId: id, urgent: row.urgent },
      'order priority changed',
    );
    return this.views.withLines(row);
  }

  /** The order, locked for this transaction; 404 outside the scope, 412 when stale. */
  async loadForWrite(
    id: string,
    actor: Actor,
    version?: number,
  ): Promise<OrderView> {
    const [row] = await this.txHost.tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), this.scope.where(actor)))
      .for('update');
    const found = this.scope.found(row);
    if (version !== undefined && found.version !== version)
      throw new VersionMismatchError('order');
    return this.views.withLines(found);
  }

  /** The versioned update every command goes through (AC-ORD-14). */
  async bump(
    id: string,
    version: number,
    changes: Partial<typeof orders.$inferInsert>,
  ): Promise<OrderRow> {
    const [row] = await this.txHost.tx
      .update(orders)
      .set({
        ...changes,
        version: version + 1,
        updatedAt: this.clock.realNow(),
      })
      .where(and(eq(orders.id, id), eq(orders.version, version)))
      .returning();
    if (!row) throw new VersionMismatchError('order');
    return row;
  }

  /** A new order row with its lines and totals, used by create and reorder. */
  private async insert(input: {
    outlet: OutletRow;
    tempClass: TempClass;
    requestedDate: string;
    deliveryDate: string;
    note: string | null;
    templateId: string | null;
    source: OrderSource;
    lines: SnapshottedLine[];
    actor: Actor;
  }): Promise<OrderRow> {
    const totals = computeTotals(input.lines);
    const [row] = await this.txHost.tx
      .insert(orders)
      .values({
        orderNo: await this.numbers.next(input.outlet.brand),
        outletId: input.outlet.id,
        depotId: input.outlet.depotId,
        brand: input.outlet.brand,
        districtId: input.outlet.districtId,
        tempClass: input.tempClass,
        requestedDate: input.requestedDate,
        deliveryDate: input.deliveryDate,
        status: 'DRAFT',
        afterCutoff: false,
        units: totals.units,
        weightKg: totals.weightKg,
        volumeM3: totals.volumeM3,
        valueLkr: totals.valueLkr,
        source: input.source,
        note: input.note,
        templateId: input.templateId,
        placedById: input.actor.id,
      })
      .returning();
    if (input.lines.length)
      await this.txHost.tx
        .insert(orderLines)
        .values(input.lines.map((line) => ({ ...line, orderId: row.id })));
    return row;
  }

  /** The actor's own outlet; a store manager without one can place no order. */
  private async ownOutlet(actor: Actor): Promise<OutletRow> {
    if (!actor.outletId)
      throw new ForbiddenError(
        'Your account is not attached to an outlet, so it cannot place orders.',
      );
    const outlet = (await this.outlets.byIds([actor.outletId])).get(
      actor.outletId,
    );
    if (!outlet) throw new NotFoundError('outlet');
    return outlet;
  }

  private async outletOf(order: OrderRow): Promise<OutletRow> {
    const outlet = (await this.outlets.byIds([order.outletId])).get(
      order.outletId,
    );
    if (!outlet) throw new NotFoundError('outlet');
    return outlet;
  }

  /** Only Fresh outlets place chilled orders; Style and Tech are ambient only. */
  private checkClass(tempClass: TempClass, outlet: OutletRow): void {
    if (tempClass === 'CHILLED' && outlet.brand !== 'FRESH')
      throw fieldError(
        'tempClass',
        'not_allowed',
        `${outlet.brand} outlets take ambient orders only.`,
      );
  }

  /**
   * A Style outlet is served once a week, so its orders are placed for that
   * weekday and no other; the response names the day (AC-ORD-08).
   */
  private checkRequestedDate(date: string, outlet: OutletRow): string {
    const dow = outlet.styleDeliveryDow;
    if (outlet.brand === 'STYLE' && dow != null) {
      const expected = WEEKDAYS[dow];
      if (weekdayOf(date) !== expected)
        throw fieldError(
          'requestedDate',
          'wrong_day',
          `This outlet takes Style deliveries on ${expected}. Choose a ${expected}.`,
        );
    }
    return date;
  }

  /** 409 with a link to the order that already holds the slot (AC-ORD-04). */
  private async refuseDuplicate(
    slot: { outletId: string; requestedDate: string; tempClass: TempClass },
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.queries.existingFor(slot);
    if (existing && existing.id !== exceptId)
      throw new DuplicateOrderError(existing.id);
  }

  /**
   * Why an action the rules refused is refused: the cutoff when the clock is
   * what stopped it, the state machine when the status is, and otherwise the
   * missing permission. Keeping it in one place stops a command answering
   * 409 CONFLICT_STATE where a screen expects CUTOFF_PASSED (AC-ORD-03).
   */
  private refusalFor(
    order: OrderView,
    action: 'edit' | 'cancel' | 'submit' | 'reorder',
  ): Error {
    const stateAllows =
      action === 'edit'
        ? order.status === 'DRAFT' || orderMachine.can(order.status, 'EDIT')
        : action === 'cancel'
          ? orderMachine.can(order.status, 'CANCEL')
          : action === 'submit'
            ? orderMachine.can(order.status, 'SUBMIT')
            : order.status !== 'DRAFT';
    if (!stateAllows)
      return new StateConflictError(refusalText(order.status, action));
    if (!this.rules.beforeCutoff(order, this.clock.now()))
      return new CutoffPassedError();
    return new ForbiddenError('You cannot do that to this order.');
  }

  /**
   * Why a line write was refused, so `OrderLinesService` answers the same
   * 409 CUTOFF_PASSED a PATCH on the order would (AC-ORD-03).
   */
  refuseEdit(order: OrderView): Error {
    return this.refusalFor(order, 'edit');
  }

  /** The order's outbox routing: the aggregate, its depot and its outlet. */
  private emit(
    type: string,
    order: OrderRow,
    payload: Record<string, unknown> & { v: number },
  ) {
    return this.outbox.add(type, payload, {
      aggregate: ['order', order.id],
      depotId: order.depotId,
      outletIds: [order.outletId],
    });
  }
}

function refusalText(status: OrderStatus, action: string): string {
  const past: Record<string, string> = {
    SUBMITTED: 'already sent',
    CONFIRMED: 'confirmed',
    PLANNED: 'on a trip',
    LOADED: 'loaded',
    IN_TRANSIT: 'on its way',
    DELIVERED: 'delivered',
    RECEIVED: 'received',
    CANCELLED: 'cancelled',
  };
  const state = past[status] ?? status.toLowerCase();
  return `This order is ${state}, so it cannot be ${action === 'submit' ? 'sent' : `${action}ed`}.`;
}

/** What a draft's own events carry: the ids and the day it is for. */
function draftEvent(order: OrderRow): OrderDraftEvent {
  return {
    v: 1,
    orderId: order.id,
    outletId: order.outletId,
    tempClass: order.tempClass,
    requestedDate: order.requestedDate,
    deliveryDate: order.deliveryDate,
  };
}
