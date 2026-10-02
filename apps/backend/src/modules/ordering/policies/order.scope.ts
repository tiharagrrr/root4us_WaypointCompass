import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import {
  orderTemplates,
  orders,
  receivingRosterEntries,
} from '../../../db/schema';

/** The part of a row the scope rules look at, so a view or a raw row both fit. */
export interface ScopedOrder {
  depotId: string;
  outletId: string;
}

/**
 * Which orders an actor may touch (specs/ordering/spec.md, Permissions):
 * an admin every one, a dispatcher and a loader their depot's (a dispatcher
 * with no depot every depot), a store manager their outlet's, a driver none
 * through this module. A row outside it answers 404, the same body as a
 * missing one, so nobody learns another outlet's order exists. Row-level
 * security repeats the rule in Postgres (`orders_app_scope`), so AC-ORD-32
 * still holds with this policy removed.
 */
@Injectable()
export class OrderScope extends ScopePolicy {
  protected readonly resource = 'order';

  where(actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'dispatcher':
      case 'loader':
        return this.sameDepot(orders.depotId, actor);
      case 'store_manager':
        return this.sameOutlet(orders.outletId, actor);
      default:
        return NO_ROWS;
    }
  }

  /**
   * The same rule on a row already in hand, for the link builders and the
   * rules: a link must never offer what `where(actor)` would hide.
   */
  covers(order: ScopedOrder, actor: Actor): boolean {
    switch (actor.role) {
      case 'admin':
        return true;
      case 'dispatcher':
        return !actor.depotId || order.depotId === actor.depotId;
      case 'loader':
        return Boolean(actor.depotId) && order.depotId === actor.depotId;
      case 'store_manager':
        return Boolean(actor.outletId) && order.outletId === actor.outletId;
      default:
        return false;
    }
  }
}

/**
 * Presets belong to one outlet, and only a store manager holds
 * `order:create`, so only their own outlet's presets are theirs to read or
 * change (AC-ORD-33).
 */
@Injectable()
export class OrderTemplateScope extends ScopePolicy {
  protected readonly resource = 'order template';

  where(actor: Actor): SQL | undefined {
    if (actor.role === 'admin') return undefined;
    if (actor.role === 'store_manager')
      return this.sameOutlet(orderTemplates.outletId, actor);
    return NO_ROWS;
  }

  covers(outletId: string, actor: Actor): boolean {
    if (actor.role === 'admin') return true;
    return actor.role === 'store_manager' && outletId === actor.outletId;
  }
}

/** The receiving roster is the outlet's own list of who takes deliveries. */
@Injectable()
export class ReceivingRosterScope extends ScopePolicy {
  protected readonly resource = 'outlet';

  where(actor: Actor): SQL | undefined {
    if (actor.role === 'admin') return undefined;
    if (actor.role === 'store_manager')
      return this.sameOutlet(receivingRosterEntries.outletId, actor);
    return NO_ROWS;
  }

  /** Whether the actor may see and replace this outlet's roster at all. */
  covers(outletId: string, actor: Actor): boolean {
    if (actor.role === 'admin') return true;
    return actor.role === 'store_manager' && outletId === actor.outletId;
  }
}
