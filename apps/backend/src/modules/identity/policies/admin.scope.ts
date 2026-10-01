import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { SQL } from 'drizzle-orm';
import { NO_ROWS, ScopePolicy } from '../../../core/auth/scope-policy';

/**
 * Users and invitations belong to no depot or outlet: admins reach every
 * row and nobody else reaches any. Only admins hold user:*, so this backs up
 * PermissionGuard rather than replacing it.
 */
abstract class AdminOnlyScope extends ScopePolicy {
  where(actor: Actor): SQL | undefined {
    return actor.role === 'admin' ? undefined : NO_ROWS;
  }
}

@Injectable()
export class UserScope extends AdminOnlyScope {
  protected readonly resource = 'user';
}

@Injectable()
export class InvitationScope extends AdminOnlyScope {
  protected readonly resource = 'invitation';
}

/** Devices as A6 manages them; a person's own devices are /me/devices. */
@Injectable()
export class DeviceScope extends AdminOnlyScope {
  protected readonly resource = 'device';
}
