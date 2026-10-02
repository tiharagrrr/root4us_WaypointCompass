import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';
import { ClockService } from '../../../core/clock/clock.service';
import { plans, stops, trips } from '../../../db/schema';
import { MY_TRIPS_WINDOW_DAYS } from '../execution.constants';

/**
 * Which trips an actor may read or record on (specs/execution/spec.md,
 * Permissions):
 *
 * - a driver her own trips of the last 7 days, which is what makes another
 *   driver's trip and her own last-month trip both 404 (AC-EXE-02);
 * - a dispatcher her depot's, or every depot when she has none;
 * - a loader her depot's, today's and tomorrow's, which is as far as the dock
 *   ever looks;
 * - an admin every trip; a store manager none, because a store sees its own
 *   delivery's ETA and never a trip.
 *
 * The window is on the plan's business date rather than on a timestamp, so
 * "the last 7 days" means seven business days in Asia/Colombo however long
 * a trip ran. A row outside the scope answers 404 with the same body as a
 * missing one.
 */
@Injectable()
export class TripScope extends ScopePolicy {
  protected readonly resource = 'trip';

  constructor(private readonly clock: ClockService) {
    super();
  }

  where(actor: Actor): SQL | undefined {
    switch (actor.role) {
      case 'admin':
        return undefined;
      case 'dispatcher':
        return this.sameDepot(trips.depotId, actor);
      case 'loader':
        return and(
          this.sameDepot(trips.depotId, actor),
          this.datesBetween(this.businessDate(0), this.businessDate(1)),
        );
      case 'driver':
        return and(
          eq(trips.driverId, actor.id),
          this.datesBetween(
            this.businessDate(-MY_TRIPS_WINDOW_DAYS),
            this.businessDate(1),
          ),
        );
      default:
        return NO_ROWS;
    }
  }

  /** The same rule on a row in hand, so a link never offers a hidden trip. */
  covers(
    trip: { depotId: string; driverId: string | null; date: string },
    actor: Actor,
  ): boolean {
    switch (actor.role) {
      case 'admin':
        return true;
      case 'dispatcher':
        return !actor.depotId || trip.depotId === actor.depotId;
      case 'loader':
        return (
          trip.depotId === actor.depotId &&
          trip.date >= this.businessDate(0) &&
          trip.date <= this.businessDate(1)
        );
      case 'driver':
        return (
          trip.driverId === actor.id &&
          trip.date >= this.businessDate(-MY_TRIPS_WINDOW_DAYS) &&
          trip.date <= this.businessDate(1)
        );
      default:
        return false;
    }
  }

  private businessDate(plusDays: number): string {
    return this.clock.businessDate(this.clock.now(), plusDays);
  }

  /** The trip's plan falls inside these business dates, both ends included. */
  private datesBetween(from: string, to: string): SQL {
    return sql`EXISTS (SELECT 1 FROM ${plans} WHERE ${plans.id} = ${trips.planId} AND ${plans.date} BETWEEN ${from} AND ${to})`;
  }
}

/**
 * Which stops an actor may read or record on: the stops of the trips they may
 * touch, so the stop rules never drift from the trip rules (AC-EXE-02). A
 * driver recording on a stop of another driver's trip gets 404, not 403: she
 * is not missing a permission, the stop is simply not hers.
 *
 * A store manager is the exception: she holds `stop:read` for her own
 * outlet's delivery, which is how she opens its proof of delivery, and sees
 * no other outlet's stop at all (AC-EXE-16).
 */
@Injectable()
export class StopScope extends ScopePolicy {
  protected readonly resource = 'stop';

  constructor(private readonly trips: TripScope) {
    super();
  }

  where(actor: Actor): SQL | undefined {
    if (actor.role === 'admin') return undefined;
    if (actor.role === 'store_manager')
      return this.sameOutlet(stops.outletId, actor);
    const onTrip = this.trips.where(actor);
    if (onTrip === undefined) return undefined;
    return sql`EXISTS (SELECT 1 FROM ${trips} WHERE ${trips.id} = ${stops.tripId} AND ${onTrip})`;
  }
}
