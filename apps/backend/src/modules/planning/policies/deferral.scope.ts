import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { and, inArray, sql, type SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { deferrals } from '../../../db/schema';

/**
 * Which deferrals an actor may read (specs/planning/spec.md, Permissions; the
 * deferred order's flow in docs/plans/backend-plan.md):
 *
 * - an admin every one;
 * - a dispatcher their depot's (every depot with none set);
 * - a store manager only their outlet's, and only what the store has been
 *   told: CONFIRMED or REVERSED, on a PUBLISHED or CLOSED plan. A proposal,
 *   or a decision on a draft that can still change, does not exist for them.
 *
 * The subqueries name their own aliases: the relational query renames the
 * table it selects from, and the outer columns are rewritten to match.
 */
@Injectable()
export class DeferralScope extends ScopePolicy {
  protected readonly resource = 'deferral';

  where(actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'dispatcher':
        return actor.depotId
          ? sql`EXISTS (SELECT 1 FROM plans p
              WHERE p.id = ${deferrals.planId} AND p."depotId" = ${actor.depotId})`
          : undefined;
      case 'store_manager':
        if (!actor.outletId) return NO_ROWS;
        return and(
          inArray(deferrals.status, ['CONFIRMED', 'REVERSED']),
          sql`EXISTS (SELECT 1 FROM plans p
            WHERE p.id = ${deferrals.planId} AND p.status IN ('PUBLISHED', 'CLOSED'))`,
          sql`EXISTS (SELECT 1 FROM orders o
            WHERE o.id = ${deferrals.orderId} AND o."outletId" = ${actor.outletId})`,
        );
      default:
        return NO_ROWS;
    }
  }
}
