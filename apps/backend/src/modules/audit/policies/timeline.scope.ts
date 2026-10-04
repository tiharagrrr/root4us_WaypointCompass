import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { orders } from '../../../db/schema';

/**
 * Whose order timelines an actor may read (specs/audit/spec.md, Permissions): the same
 * rows the order itself is visible in. An admin every order, a dispatcher and a loader
 * their depot's (a dispatcher with no depot every depot), a store manager their outlet's.
 * A driver holds no `order:read` and is refused before this runs. An order outside the
 * scope answers 404, the same body as a missing one (AC-AUD-20).
 */
@Injectable()
export class OrderTimelineScope extends ScopePolicy {
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
}
