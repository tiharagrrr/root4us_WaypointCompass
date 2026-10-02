import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { alerts } from '../../../db/schema';

/**
 * Which alerts an actor may read or act on (specs/alerts/spec.md,
 * Permissions): a dispatcher their own depot's, or every depot when they are
 * scoped to none, and an admin every one. Nobody else sees an alert at all.
 *
 * Only `alert:read` and `alert:act` reach these queries, and both are held by
 * dispatchers alone, so the other roles are stopped by PermissionGuard with a
 * 403 before the scope is consulted (AC-ALR-09). The `admin` branch is here
 * because an admin can be given `alert:read` without this policy hiding every
 * row from them; today the matrix gives them neither.
 *
 * A dispatcher scoped to another depot gets 404, with the same body as a
 * missing alert, so nobody learns that Peliyagoda has a problem (AC-ALR-07).
 */
@Injectable()
export class AlertScope extends ScopePolicy {
  protected readonly resource = 'alert';

  where(actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'dispatcher':
        return this.sameDepot(alerts.depotId, actor);
      default:
        return NO_ROWS;
    }
  }
}
