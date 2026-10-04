import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { ClockService } from '../../../core/clock/clock.service';
import { plans, trips } from '../../../db/schema';

/**
 * Whose trips a device hears about on `GET /sync/changes` (specs/sync/spec.md, Permissions):
 *
 * - a driver's phone: her own trips;
 * - a dock tablet: its depot's trips for today and tomorrow, the window the dock works in;
 * - nobody else: the feed is for field devices, and any other role is refused before this runs.
 *
 * `where` is a filter on `trips`; the feed wraps it in a subquery over the outbox.
 */
@Injectable()
export class ChangesScope extends ScopePolicy {
  protected readonly resource = 'trip';

  constructor(private readonly clock: ClockService) {
    super();
  }

  where(actor: Actor): SQL {
    switch (actor.role) {
      case 'driver':
        return eq(trips.driverId, actor.id);
      case 'loader': {
        // A loader with no depot has no dock to stand on.
        if (!actor.depotId) return NO_ROWS;
        const dates = [
          this.clock.businessDate(),
          this.clock.businessDate(undefined, 1),
        ];
        return sql`${eq(trips.depotId, actor.depotId)} AND EXISTS (SELECT 1 FROM ${plans} WHERE ${and(
          eq(plans.id, trips.planId),
          inArray(plans.date, dates),
        )})`;
      }
      default:
        return NO_ROWS;
    }
  }
}
