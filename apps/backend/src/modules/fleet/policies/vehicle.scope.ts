import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { ScopePolicy } from '../../../core/auth/scope-policy';
import { vehicles } from '../../../db/schema';

/**
 * Which vehicles a caller may read. A dispatcher works in one depot, so they
 * see its fleet, or every depot when they have none (specs/fleet/spec.md).
 * Everyone else with `masterData:read` reads the whole fleet, as they do
 * depots and outlets: a vehicle is reference data, and the write endpoints
 * are the ones a permission closes. Who may read a vehicle's *driver* is a
 * separate question, answered in VehicleQueries.
 */
@Injectable()
export class VehicleScope extends ScopePolicy {
  protected readonly resource = 'vehicle';

  where(actor: Actor): SQL | undefined {
    if (actor.role !== 'dispatcher') return undefined;
    return this.sameDepot(vehicles.depotId, actor);
  }
}
