import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { plans } from '../../../db/schema';

/**
 * Whose runs an actor sees: a run belongs to its plan's depot. An admin sees
 * every run, a dispatcher her depot's (every depot when she has none), and
 * nobody else holds simulation:run. The query joins plans.
 */
@Injectable()
export class SimulationScope extends ScopePolicy {
  protected readonly resource = 'simulation';

  where(actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'dispatcher':
        return this.sameDepot(plans.depotId, actor);
      default:
        return NO_ROWS;
    }
  }
}
