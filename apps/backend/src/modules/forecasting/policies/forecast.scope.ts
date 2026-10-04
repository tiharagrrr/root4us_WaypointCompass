import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { depots } from '../../../db/schema';

/**
 * Whose forecast a caller may read: an admin reads every depot's, a
 * dispatcher their own depot's, or every depot's when they have none
 * (specs/forecasting/spec.md). Another depot answers 404.
 */
@Injectable()
export class ForecastScope extends ScopePolicy {
  protected readonly resource = 'depot';

  where(actor: Actor): SQL | undefined {
    if (actor.role === 'admin') return undefined;
    if (actor.role === 'dispatcher') return this.sameDepot(depots.id, actor);
    return NO_ROWS;
  }
}
