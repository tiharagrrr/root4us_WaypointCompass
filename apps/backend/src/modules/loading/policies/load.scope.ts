import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { and, type AnyColumn, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { ClockService } from '../../../core/clock/clock.service';
import { plans, trips } from '../../../db/schema';

/**
 * Which trips an actor may load, supervise or release (specs/loading/spec.md,
 * Permissions):
 *
 * - a **loader** sees their own depot's trips, and only today's and
 *   tomorrow's: the dock works a shift, not an archive, and a tablet left on
 *   a bench overnight must not be able to go back and edit a run that has
 *   already been delivered (AC-LOD-02);
 * - a **dispatcher** sees their depot's trips, or every depot's when they are
 *   scoped to none, with no date window — the flag queue on 01 and 19 is a
 *   day's work but 23's history reads the same rows;
 * - an **admin** sees every trip, so an audit question can be answered;
 *   today's matrix gives them no load permission, so PermissionGuard stops
 *   them with a 403 first and this branch never runs.
 *
 * Nobody else sees a load list at all. A trip outside the window answers 404
 * with the same body as a missing one, so a loader learns nothing about
 * yesterday's runs or another depot's (AC-LOD-02).
 *
 * The filter is an `EXISTS` over the trip, so it ANDs onto `load_check_lines`,
 * `load_flags`, `load_releases` and `trips` itself without any of those
 * queries needing a join of their own.
 */
@Injectable()
export class LoadScope extends ScopePolicy {
  protected readonly resource = 'trip';

  constructor(private readonly clock: ClockService) {
    super();
  }

  /**
   * The scope as a filter on `trips.id`, for a query that selects from
   * `trips`. Use `forTrip` for a query on one of loading's own tables.
   */
  where(actor: Actor): SQL | undefined {
    const rules = this.rulesFor(actor);
    if (rules === 'none') return NO_ROWS;
    if (rules === 'all') return undefined;
    return and(...rules);
  }

  /**
   * The scope as a filter on another table's trip id: the trips the actor may
   * touch, as a subquery.
   *
   * The subquery's own column references are written as SQL text rather than
   * as drizzle columns. `CrudQueryService` runs the flag queue through the
   * relational query builder, which rewrites the column references in a `sql`
   * fragment against the aliases of *its* query — so a `trips.depotId` handed
   * to it comes back as `loadFlags.depotId`, a column that does not exist.
   * Only `column`, which belongs to the queried table, is interpolated as a
   * column; the actor's own values are still bound parameters.
   */
  forTrip(column: AnyColumn, actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'dispatcher':
        if (!actor.depotId) return undefined;
        return sql`${column} IN (SELECT t.id FROM trips t WHERE t."depotId" = ${actor.depotId})`;
      case 'loader': {
        if (!actor.depotId) return NO_ROWS;
        const [today, tomorrow] = this.shiftDates();
        return sql`${column} IN (
          SELECT t.id FROM trips t JOIN plans p ON p.id = t."planId"
          WHERE t."depotId" = ${actor.depotId} AND p.date IN (${today}, ${tomorrow}))`;
      }
      default:
        return NO_ROWS;
    }
  }

  /**
   * The dates a loader may work on: today and tomorrow in Asia/Colombo, read
   * from the demo clock so time travel moves the dock's window with it.
   */
  shiftDates(): [string, string] {
    return [this.clock.businessDate(), this.clock.businessDate(undefined, 1)];
  }

  private rulesFor(actor: Actor): SQL[] | 'all' | 'none' {
    switch (actor.role) {
      case 'admin':
        return 'all';
      case 'dispatcher': {
        const depot = this.sameDepot(trips.depotId, actor);
        return depot ? [depot] : 'all';
      }
      case 'loader': {
        // A loader with no depot has no dock to stand on.
        if (!actor.depotId) return 'none';
        return [
          eq(trips.depotId, actor.depotId),
          sql`EXISTS (SELECT 1 FROM ${plans} WHERE ${and(
            eq(plans.id, trips.planId),
            inArray(plans.date, this.shiftDates()),
          )})`,
        ];
      }
      default:
        return 'none';
    }
  }
}
