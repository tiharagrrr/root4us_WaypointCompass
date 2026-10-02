import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { OrderTemplateDto } from '../dto/order-template.dto';
import type { OrderTemplateView } from '../services/templates.service';

const BASE = '/api/v1/order-templates';

/** A preset on M1, with rename and delete for the store that owns it. */
@Injectable()
export class OrderTemplateLinks extends LinkBuilder<
  OrderTemplateView,
  Omit<OrderTemplateDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(t: OrderTemplateView) {
    return `${BASE}/${t.id}`;
  }

  protected actions(t: OrderTemplateView, actor: Actor): LinkMap {
    const mine = can(actor, 'order:create') && t.outletId === actor.outletId;
    return {
      rename: mine && {
        href: this.self(t),
        method: 'PATCH',
        title: 'Rename preset',
      },
      remove: mine && {
        href: this.self(t),
        method: 'DELETE',
        title: 'Delete preset',
      },
      // M1 starts an order from a preset by sending its id to POST /orders.
      useForOrder: mine && {
        href: `/api/v1/orders`,
        method: 'POST',
        title: 'Start an order from this preset',
        requires: ['Idempotency-Key', 'templateId'],
      },
    };
  }

  protected present(t: OrderTemplateView): Omit<OrderTemplateDto, '_links'> {
    return {
      id: t.id,
      name: t.name,
      tempClass: t.tempClass,
      lines: t.lines.map((l) => ({
        itemId: l.itemId,
        sku: l.sku,
        name: l.name,
        packLabel: l.packLabel,
        qty: l.qty,
      })),
      createdAt: this.clock.toIso(t.createdAt),
    };
  }
}
