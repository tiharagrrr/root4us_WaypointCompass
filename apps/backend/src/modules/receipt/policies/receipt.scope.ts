import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { type SQL, sql } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { issues } from '../../../db/schema';

/**
 * Which issues an actor may touch (specs/receipt/spec.md, Permissions): a store manager
 * their outlet's, a dispatcher their depot's (every depot when none is set), nobody else.
 * Admin and loader hold no issue permission and are refused before this runs; a driver
 * raises issues but reads none. A row outside the scope answers 404, the same body as a
 * missing one. Row-level security repeats the rule in Postgres (`issues_app_scope`).
 *
 * Receipts need no policy of their own: they are read through the order, whose scope
 * (the store's outlet, the dispatcher's depot) already decides.
 */
@Injectable()
export class IssueScope extends ScopePolicy {
  protected readonly resource = 'issue';

  where(actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'dispatcher':
        // The subquery names its table and columns itself: inside the relational query the
        // builder aliases the issues table, which would otherwise rewrite the outlets columns.
        return actor.depotId
          ? sql`${issues.outletId} IN (SELECT "outlets"."id" FROM "outlets" WHERE "outlets"."depotId" = ${actor.depotId})`
          : undefined;
      case 'store_manager':
        return this.sameOutlet(issues.outletId, actor);
      default:
        return NO_ROWS;
    }
  }
}
