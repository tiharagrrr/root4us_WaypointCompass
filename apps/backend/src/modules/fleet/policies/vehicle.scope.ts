import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { ScopePolicy } from '../../../core/auth/scope-policy';
import { vehicles } from '../../../db/schema';

/**
 * Which vehicles a planner may read: an admin sees every depot, a dispatcher
 * their own depot, or every depot when none is set (specs/fleet/spec.md).
 * The fuel endpoint is `plan:read`, so no other role gets this far.
 */
@Injectable()
export class VehicleScope extends ScopePolicy {
  protected readonly resource = 'vehicle';

  where(actor: Actor): SQL | undefined {
    if (actor.role === 'admin') return undefined;
    return this.sameDepot(vehicles.depotId, actor);
  }
}
