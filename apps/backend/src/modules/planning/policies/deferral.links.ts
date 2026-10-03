import { Injectable } from '@nestjs/common';
import {
  type Actor,
  can,
  deferralMachine,
  type DeferralStatus,
  type StoreResponse,
  storeResponseMachine,
} from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { DeferralDto } from '../dto/deferral.dto';
import type { DeferralView } from '../services/deferral.queries';

/**
 * Whether the store may still answer: the deferral is CONFIRMED and not yet
 * answered, the store has been told (its plan is published or closed), and
 * the order is still waiting. Once a later run carries the order there is
 * nothing left to respond to (the deferred order's flow).
 */
export function canRespond(d: DeferralView, actor: Actor): boolean {
  return (
    can(actor, 'deferral:respond') &&
    d.status === 'CONFIRMED' &&
    storeResponseMachine.can(d.storeResponse as StoreResponse, 'ACKNOWLEDGE') &&
    (d.planStatus === 'PUBLISHED' || d.planStatus === 'CLOSED') &&
    d.orderStatus === 'DEFERRED'
  );
}

/** 19c: a dispatcher keeps a delivery the device recorded for a confirmed deferral. */
export function canReverse(d: DeferralView, actor: Actor): boolean {
  return (
    can(actor, 'deferral:decide') &&
    deferralMachine.can(d.status as DeferralStatus, 'REVERSE')
  );
}

/**
 * A deferral's `_links`: `respond` and `reverse` appear only when the service
 * would accept them, from the same two checks (architecture rule 9).
 */
@Injectable()
export class DeferralLinks extends LinkBuilder<DeferralView, DeferralDto> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(d: DeferralView): string {
    return `/api/v1/deferrals/${d.id}`;
  }

  protected actions(d: DeferralView, actor: Actor): LinkMap {
    const self = this.self(d);
    return {
      order: { href: `/api/v1/orders/${d.orderId}` },
      respond: canRespond(d, actor) && {
        href: `${self}/response`,
        method: 'POST',
        title: 'Respond',
        requires: ['Idempotency-Key'],
      },
      reverse: canReverse(d, actor) && {
        href: `${self}/reverse`,
        method: 'POST',
        title: 'Keep the delivery',
        requires: ['Idempotency-Key'],
      },
    };
  }

  protected present(d: DeferralView): DeferralDto {
    const dto: Partial<DeferralView> = { ...d };
    delete dto.depotId;
    delete dto.planStatus;
    return dto as DeferralDto;
  }
}
