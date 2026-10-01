import type { Actor } from '@waypoint/shared';
import { type AnyColumn, eq, sql, type SQL } from 'drizzle-orm';
import { NotFoundError } from '../errors/domain-errors';

/** Matches no row: the scope of a role that may see none of a resource. */
export const NO_ROWS: SQL = sql`false`;

/**
 * Which rows of one resource an actor may touch. Each module subclasses it
 * (OrderScope, TripScope, ...), every query ANDs `where(actor)` in, and a row
 * outside it answers 404 NOT_FOUND with the same body as a missing one, so
 * nobody learns that another outlet's order exists. A missing permission is
 * PermissionGuard's 403, checked before this runs. Row-level security
 * re-checks the same rules in Postgres (src/db/rls.ts).
 */
export abstract class ScopePolicy {
  /** The resource named in the 404 detail, e.g. "order". */
  protected abstract readonly resource: string;

  /** The filter for this actor's rows; undefined means every row. */
  abstract where(actor: Actor): SQL | undefined;

  /** The row, or 404 when it is missing or outside the scope. */
  found<T>(row: T | null | undefined): T {
    if (row == null) throw new NotFoundError(this.resource);
    return row;
  }

  /** Their depot; a dispatcher with no depot sees every depot, anyone else without one sees nothing. */
  protected sameDepot(column: AnyColumn, actor: Actor): SQL | undefined {
    if (actor.depotId) return eq(column, actor.depotId);
    return actor.role === 'dispatcher' ? undefined : NO_ROWS;
  }

  /** A store manager's own outlet. */
  protected sameOutlet(column: AnyColumn, actor: Actor): SQL {
    return actor.outletId ? eq(column, actor.outletId) : NO_ROWS;
  }
}
