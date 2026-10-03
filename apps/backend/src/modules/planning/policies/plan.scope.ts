import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { plans } from '../../../db/schema';

/**
 * Which plans an actor may read or build: an admin every depot, a dispatcher
 * their own depot or every depot when none is set (specs/planning/spec.md,
 * Permissions). Trips, stops, runs and revisions follow their plan. Out of
 * scope is 404 (AC-PLN-32).
 */
@Injectable()
export class PlanScope extends ScopePolicy {
  protected readonly resource = 'plan';

  where(actor: Actor): SQL | undefined {
    if (actor.role === 'admin') return undefined;
    if (actor.role === 'dispatcher')
      return this.sameDepot(plans.depotId, actor);
    return NO_ROWS;
  }

  /** Whether the actor may see a depot's plans at all, before any plan row exists. */
  allowsDepot(depotId: string, actor: Actor): boolean {
    if (actor.role === 'admin') return true;
    if (actor.role !== 'dispatcher') return false;
    return !actor.depotId || actor.depotId === depotId;
  }
}
