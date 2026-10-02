import { Injectable } from '@nestjs/common';
import { type Actor, isUserRole } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';

/**
 * Reference data is the same for everyone who may read it: every Waypoint
 * role holds `masterData:read` and sees every depot, district and outlet,
 * because a driver's offline bundle, a dispatcher's map and a store's catalog
 * all read the same facts. `PermissionGuard` decides who may read or change
 * them, so there is no row split to make here, and these tables carry no
 * row-level security policy. An account with no Waypoint role sees nothing.
 */
abstract class ReferenceScope extends ScopePolicy {
  where(actor: Actor): SQL | undefined {
    return isUserRole(actor.role) ? undefined : NO_ROWS;
  }
}

@Injectable()
export class OutletScope extends ReferenceScope {
  protected readonly resource = 'outlet';
}

@Injectable()
export class DepotScope extends ReferenceScope {
  protected readonly resource = 'depot';
}
