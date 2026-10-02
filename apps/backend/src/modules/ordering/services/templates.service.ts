import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor, TempClass } from '@waypoint/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  ForbiddenError,
  NotFoundError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { items, orderTemplateLines, orderTemplates } from '../../../db/schema';
import { AuditService } from '../../audit';
import { OutletQueries } from '../../master-data';
import { DuplicateTemplateError } from '../domain/errors';
import type {
  CreateOrderTemplateDto,
  UpdateOrderTemplateDto,
} from '../dto/order-template.dto';
import { ORDER_AUDIT, ORDER_EVENTS } from '../ordering.constants';
import { ORDER_TEMPLATE_RESOURCE } from '../order-template.resource';
import { OrderTemplateScope } from '../policies/order.scope';
import { OrderLinesValidator } from './order-lines.validator';

export type OrderTemplateRow = typeof orderTemplates.$inferSelect;

/** A preset line with the item fields M1 shows before the order exists. */
export interface TemplateLineView {
  itemId: string;
  qty: number;
  sku: string;
  name: string;
  packLabel: string;
}

export interface OrderTemplateView extends OrderTemplateRow {
  lines: TemplateLineView[];
}

/**
 * Presets: the saved line sets behind M1's "Load a saved preset" and "Save as
 * preset" (AC-ORD-27). A preset belongs to one outlet and one temperature
 * class, so a dry preset can never be applied to a chilled order, and its
 * name is unique at the outlet.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly crud: CrudQueryService,
    private readonly scope: OrderTemplateScope,
    private readonly outlets: OutletQueries,
    private readonly validator: OrderLinesValidator,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(TemplatesService.name);
  }

  async list(query: ListQuery, actor: Actor): Promise<Page<OrderTemplateView>> {
    const page = await this.crud.list<OrderTemplateRow>(
      ORDER_TEMPLATE_RESOURCE,
      query,
      this.scope.where(actor),
    );
    return { ...page, items: await this.withLines(page.items) };
  }

  async get(id: string, actor: Actor): Promise<OrderTemplateView> {
    const row = await this.crud.get<OrderTemplateRow>(
      ORDER_TEMPLATE_RESOURCE,
      id,
      this.scope.where(actor),
    );
    return (await this.withLines([row]))[0];
  }

  /** A preset built from scratch on M1 (POST /order-templates). */
  @Transactional()
  async create(
    dto: CreateOrderTemplateDto,
    actor: Actor,
  ): Promise<OrderTemplateView> {
    const outletId = this.ownOutlet(actor);
    const outlet = (await this.outlets.byIds([outletId])).get(outletId);
    if (!outlet) throw new NotFoundError('outlet');
    const lines = await this.validator.snapshot(dto.lines, {
      brand: outlet.brand,
      tempClass: dto.tempClass,
    });
    return this.save(
      { outletId, name: dto.name, tempClass: dto.tempClass },
      lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      actor,
    );
  }

  /** M1's "Save as preset": the open order's lines kept for next time. */
  @Transactional()
  async fromOrder(
    order: { id: string; outletId: string; tempClass: TempClass },
    lines: readonly { itemId: string; qty: number }[],
    name: string,
    actor: Actor,
  ): Promise<OrderTemplateView> {
    if (!this.scope.covers(order.outletId, actor))
      throw new NotFoundError('order');
    return this.save(
      { outletId: order.outletId, name, tempClass: order.tempClass },
      lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      actor,
      order.id,
    );
  }

  @Transactional()
  async update(
    id: string,
    dto: UpdateOrderTemplateDto,
    actor: Actor,
  ): Promise<OrderTemplateView> {
    const before = await this.get(id, actor);
    if (!dto.name || dto.name === before.name) return before;
    await this.refuseDuplicateName(before.outletId, dto.name);
    const [row] = await this.txHost.tx
      .update(orderTemplates)
      .set({ name: dto.name })
      .where(eq(orderTemplates.id, id))
      .returning();
    await this.audit.record({
      action: ORDER_AUDIT.templateRenamed,
      entity: ['order_template', id],
      before: { name: before.name },
      after: { name: row.name },
    });
    return (await this.withLines([row]))[0];
  }

  @Transactional()
  async remove(id: string, actor: Actor): Promise<void> {
    const before = await this.get(id, actor);
    await this.txHost.tx
      .delete(orderTemplates)
      .where(eq(orderTemplates.id, id));
    await this.audit.record({
      action: ORDER_AUDIT.templateDeleted,
      entity: ['order_template', id],
      before: { name: before.name, tempClass: before.tempClass },
    });
    await this.outbox.add(
      ORDER_EVENTS.templateDeleted,
      { v: 1, templateId: id, outletId: before.outletId },
      {
        aggregate: ['order_template', id],
        outletIds: [before.outletId],
      },
    );
    this.log.info(
      { event: ORDER_AUDIT.templateDeleted, templateId: id },
      'preset deleted',
    );
  }

  /**
   * The preset a new order starts from: it must belong to the outlet and
   * carry the order's class, or it is simply not there (AC-ORD-27, AC-ORD-33).
   */
  async forOrder(
    id: string,
    outletId: string,
    tempClass: TempClass,
  ): Promise<OrderTemplateView> {
    const [row] = await this.txHost.tx
      .select()
      .from(orderTemplates)
      .where(
        and(
          eq(orderTemplates.id, id),
          eq(orderTemplates.outletId, outletId),
          eq(orderTemplates.tempClass, tempClass),
        ),
      );
    if (!row) throw new NotFoundError('order template');
    return (await this.withLines([row]))[0];
  }

  private async save(
    template: { outletId: string; name: string; tempClass: TempClass },
    lines: { itemId: string; qty: number }[],
    actor: Actor,
    fromOrderId?: string,
  ): Promise<OrderTemplateView> {
    await this.refuseDuplicateName(template.outletId, template.name);
    const [row] = await this.txHost.tx
      .insert(orderTemplates)
      .values({ ...template, createdById: actor.id })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new DuplicateTemplateError(template.name);
    if (lines.length)
      await this.txHost.tx
        .insert(orderTemplateLines)
        .values(lines.map((l) => ({ ...l, templateId: row.id })));

    await this.audit.record({
      action: ORDER_AUDIT.templateSaved,
      entity: ['order_template', row.id],
      after: {
        name: row.name,
        tempClass: row.tempClass,
        lines: lines.length,
        ...(fromOrderId && { fromOrderId }),
      },
    });
    await this.outbox.add(
      ORDER_EVENTS.templateCreated,
      { v: 1, templateId: row.id, outletId: row.outletId },
      { aggregate: ['order_template', row.id], outletIds: [row.outletId] },
    );
    this.log.info(
      {
        event: ORDER_AUDIT.templateSaved,
        templateId: row.id,
        outletId: row.outletId,
        lines: lines.length,
      },
      'preset saved',
    );
    return (await this.withLines([row]))[0];
  }

  /** Each preset's lines, with the item fields M1 shows. */
  private async withLines(
    rows: OrderTemplateRow[],
  ): Promise<OrderTemplateView[]> {
    if (rows.length === 0) return [];
    const lines = await this.txHost.tx
      .select({
        templateId: orderTemplateLines.templateId,
        itemId: orderTemplateLines.itemId,
        qty: orderTemplateLines.qty,
        sku: items.sku,
        name: items.name,
        packLabel: items.packLabel,
      })
      .from(orderTemplateLines)
      .innerJoin(items, eq(items.id, orderTemplateLines.itemId))
      .where(
        inArray(
          orderTemplateLines.templateId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(items.name));
    return rows.map((row) => ({
      ...row,
      lines: lines
        .filter((l) => l.templateId === row.id)
        .map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          sku: l.sku,
          name: l.name,
          packLabel: l.packLabel,
        })),
    }));
  }

  private ownOutlet(actor: Actor): string {
    if (!actor.outletId)
      throw new ForbiddenError(
        'Your account is not attached to an outlet, so it has no presets.',
      );
    return actor.outletId;
  }

  /**
   * Preset names are unique per outlet. The database says so too
   * (`order_templates_name_uq`); checking here lets the 409 name the preset
   * rather than the constraint (AC-ORD-27).
   */
  private async refuseDuplicateName(
    outletId: string,
    name: string,
  ): Promise<void> {
    const [clash] = await this.txHost.tx
      .select({ id: orderTemplates.id })
      .from(orderTemplates)
      .where(
        and(
          eq(orderTemplates.outletId, outletId),
          eq(orderTemplates.name, name),
        ),
      )
      .limit(1);
    if (clash) throw new DuplicateTemplateError(name);
  }
}
