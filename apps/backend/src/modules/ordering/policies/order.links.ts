import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { compact, LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { Collection } from '../../../core/http/envelope.interceptor';
import { lineMeasures } from '../domain/totals';
import type { OrderDto, OrderLineDto, OrderLinesDto } from '../dto/order.dto';
import type { OrderLineView, OrderView } from '../services/order.view';
import { OrderRules } from './order.rules';

const BASE = '/api/v1/orders';

/**
 * An order as every screen reads it (M1, M1b, M2, M3, M8, 03, 04), with the
 * actions allowed right now. Each action link is built from the `OrderRules`
 * method the service calls, so a sent order past its cutoff offers no edit
 * or cancel at all (AC-ORD-03, AC-ORD-15).
 */
@Injectable()
export class OrderLinks extends LinkBuilder<
  OrderView,
  Omit<OrderDto, '_links'>
> {
  constructor(
    protected readonly clock: ClockService,
    private readonly rules: OrderRules,
  ) {
    super();
  }

  protected self(o: OrderView) {
    return `${BASE}/${o.id}`;
  }

  protected actions(o: OrderView, actor: Actor, now: Date): LinkMap {
    const self = this.self(o);
    const edit = this.rules.canEdit(o, actor, now);
    return {
      lines: { href: `${self}/lines` },
      timeline: { href: `/api/v1/timelines/order/${o.id}` },
      submit: this.rules.canSubmit(o, actor) && {
        href: `${self}/submit`,
        method: 'POST',
        title: 'Send order',
        requires: ['If-Match', 'Idempotency-Key'],
      },
      edit: edit && {
        href: self,
        method: 'PATCH',
        title: 'Edit order',
        requires: ['If-Match'],
      },
      addLine: edit && {
        href: `${self}/lines`,
        method: 'POST',
        title: 'Add item',
        requires: ['If-Match'],
      },
      setLines: edit && {
        href: `${self}/lines`,
        method: 'PUT',
        title: 'Replace items',
        requires: ['If-Match'],
      },
      cancel: this.rules.canCancel(o, actor, now) && {
        href: `${self}/cancel`,
        method: 'POST',
        title: 'Cancel order',
        requires:
          actor.role === 'store_manager'
            ? ['If-Match', 'Idempotency-Key', 'reasonNote']
            : ['If-Match', 'Idempotency-Key', 'reasonCode'],
      },
      delete: this.rules.canDelete(o, actor) && {
        href: self,
        method: 'DELETE',
        title: 'Delete draft',
        requires: ['If-Match'],
      },
      reorder: this.rules.canReorder(o, actor) && {
        href: `${self}/reorder`,
        method: 'POST',
        title: 'Order again',
        requires: ['Idempotency-Key'],
      },
      saveAsTemplate: this.rules.canSaveAsTemplate(o, actor) && {
        href: `${self}/save-as-template`,
        method: 'POST',
        title: 'Save as preset',
        requires: ['Idempotency-Key'],
      },
      priority: this.rules.canSetPriority(o, actor) && {
        href: `${self}/priority`,
        method: 'PATCH',
        title: o.urgent ? 'Clear urgent' : 'Mark urgent',
        requires: ['If-Match'],
      },
    };
  }

  protected present(o: OrderView): Omit<OrderDto, '_links'> {
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      tempClass: o.tempClass,
      brand: o.brand,
      requestedDate: o.requestedDate,
      deliveryDate: o.deliveryDate,
      afterCutoff: o.afterCutoff,
      urgent: o.urgent,
      totals: o.totals,
      outlet: o.outlet,
      deliveryWindow: o.deliveryWindow,
      note: o.note,
      templateId: o.templateId,
      submittedAt: o.submittedAt ? this.clock.toIso(o.submittedAt) : null,
      cancelledAt: o.cancelledAt ? this.clock.toIso(o.cancelledAt) : null,
      cancelReason: o.cancelReason,
      editableUntil: this.clock.toIso(o.editableUntil),
      version: o.version,
    };
  }

  /** `GET /orders/{id}/lines`: the lines plus the version to send as If-Match. */
  lines(order: OrderView, actor: Actor): OrderLinesDto {
    const now = this.clock.now();
    const editable = this.rules.canEdit(order, actor, now);
    return {
      orderId: order.id,
      version: order.version,
      lines: (order.lines ?? []).map((line) =>
        this.line(order, line, editable),
      ),
      _links: compact({
        self: { href: `${BASE}/${order.id}/lines` },
        order: { href: `${BASE}/${order.id}` },
        addLine: editable && {
          href: `${BASE}/${order.id}/lines`,
          method: 'POST',
          title: 'Add item',
          requires: ['If-Match'],
        },
        setLines: editable && {
          href: `${BASE}/${order.id}/lines`,
          method: 'PUT',
          title: 'Replace items',
          requires: ['If-Match'],
        },
      }),
    };
  }

  private line(
    order: OrderView,
    line: OrderLineView,
    editable: boolean,
  ): OrderLineDto {
    const self = `${BASE}/${order.id}/lines/${line.id}`;
    const measures = lineMeasures(line);
    return {
      id: line.id,
      itemId: line.itemId,
      sku: line.sku,
      name: line.name,
      packLabel: line.packLabel,
      qty: line.qty,
      unitWeightKg: line.unitWeightKg,
      unitVolumeM3: line.unitVolumeM3,
      weightKg: measures.weightKg,
      volumeM3: measures.volumeM3,
      available: line.available,
      _links: compact({
        self: { href: self },
        edit: editable && {
          href: self,
          method: 'PATCH',
          title: 'Change quantity',
          requires: ['If-Match'],
        },
        remove: editable && {
          href: self,
          method: 'DELETE',
          title: 'Remove item',
          requires: ['If-Match'],
        },
      }),
    };
  }
}

/** The order collection's own links; `create` only for someone who may place one. */
export type OrderCollection = Collection<OrderDto>;
