import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor, TempClass } from '@waypoint/shared';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { orders } from '../../../db/schema';
import { ORDER_RESOURCE } from '../order.resource';
import { OrderScope } from '../policies/order.scope';
import type { OrderRow, OrderView } from './order.view';
import { OrderViews } from './order.views';

/**
 * Reads of orders, always through the module's scope (architecture rule 5),
 * so M3 and M8 see one outlet's orders and 03 and 04 see one depot's. Every
 * row comes back as an `OrderView`, with the outlet, cutoff, window and
 * totals a response needs.
 */
@Injectable()
export class OrderQueries {
  constructor(
    private readonly crud: CrudQueryService,
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: OrderScope,
    private readonly views: OrderViews,
  ) {}

  async list(query: ListQuery, actor: Actor): Promise<Page<OrderView>> {
    const page = await this.crud.list<OrderRow>(
      ORDER_RESOURCE,
      query,
      this.scope.where(actor),
    );
    return { ...page, items: await this.views.many(page.items) };
  }

  /** One order, or 404 when it is missing or outside the caller's scope. */
  async get(id: string, actor: Actor, include?: string): Promise<OrderView> {
    const row = await this.crud.get<OrderRow>(
      ORDER_RESOURCE,
      id,
      this.scope.where(actor),
      include,
    );
    return this.views.one(row);
  }

  /** One order with its lines, for `GET /orders/{id}/lines`. */
  async getWithLines(id: string, actor: Actor): Promise<OrderView> {
    const row = await this.crud.get<OrderRow>(
      ORDER_RESOURCE,
      id,
      this.scope.where(actor),
    );
    return this.views.withLines(row);
  }

  /**
   * The order that already holds this outlet, requested date and class, if
   * one does. Cancelled orders free the slot, and a backorder is exempt
   * because it carries a parent (AC-ORD-04, AC-ORD-19).
   */
  async existingFor(input: {
    outletId: string;
    requestedDate: string;
    tempClass: TempClass;
  }): Promise<OrderRow | undefined> {
    const [row] = await this.txHost.tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.outletId, input.outletId),
          eq(orders.requestedDate, input.requestedDate),
          eq(orders.tempClass, input.tempClass),
          ne(orders.status, 'CANCELLED'),
          inArray(orders.source, ['web', 'seed', 'reorder']),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * The orders a depot's plan for a date is built from: CONFIRMED orders for
   * that date, and DEFERRED orders an earlier plan moved to it (they wait as
   * DEFERRED until a run carries them). Sorted by order number, so the
   * engine's input is the same every time.
   *
   * No actor scope: planning calls this for a plan it has already loaded
   * within its own scope, the way it calls the lifecycle methods.
   */
  async queueFor(depotId: string, date: string): Promise<OrderRow[]> {
    return this.txHost.tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.depotId, depotId),
          eq(orders.deliveryDate, date),
          inArray(orders.status, ['CONFIRMED', 'DEFERRED']),
        ),
      )
      .orderBy(asc(orders.orderNo));
  }
}
