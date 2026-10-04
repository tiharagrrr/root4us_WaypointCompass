import { Injectable } from '@nestjs/common';
import { type Actor, can, isUserRole } from '@waypoint/shared';
import { AppConfig } from '../../../config/app-config';
import { ClockService } from '../../../core/clock/clock.service';
import { ForbiddenError } from '../../../core/errors/domain-errors';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { UserDto } from '../dto/user.dto';
import type { NamedUser } from '../services/user.queries';

/** A user on A1, with the changes the admin may make now. */
@Injectable()
export class UserLinks extends LinkBuilder<NamedUser, Omit<UserDto, '_links'>> {
  constructor(
    protected readonly clock: ClockService,
    private readonly config: AppConfig,
  ) {
    super();
  }

  protected self(u: NamedUser) {
    return `/api/v1/users/${u.id}`;
  }

  protected actions(u: NamedUser, actor: Actor): LinkMap {
    const self = this.self(u);
    const banned = u.banned === true;
    return {
      edit: can(actor, 'user:set-role') && {
        href: self,
        method: 'PATCH',
        title: 'Change role or scope',
        requires: ['reasonCode'],
      },
      deactivate: !banned &&
        can(actor, 'user:ban') && {
          href: `${self}/deactivate`,
          method: 'POST',
          title: 'Deactivate',
        },
      reactivate: banned &&
        can(actor, 'user:ban') && {
          href: `${self}/reactivate`,
          method: 'POST',
          title: 'Reactivate',
        },
      setPin: u.role === 'loader' &&
        can(actor, 'user:set-password') && {
          href: `${self}/pin`,
          method: 'PUT',
          title: u.pinHash ? 'Change PIN' : 'Set PIN',
        },
    };
  }

  protected present(u: NamedUser): Omit<UserDto, '_links'> {
    if (!isUserRole(u.role))
      throw new ForbiddenError('This account has no Waypoint role.');
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      username: u.username,
      phoneNumber: u.phoneNumber,
      role: u.role,
      depotId: u.depotId,
      outletId: u.outletId,
      vehicleId: u.defaultVehicleId,
      banned: u.banned ?? false,
      hasPin: u.pinHash !== null,
      demoPin: this.config.demo.enabled === true ? u.demoPin : null,
      scopeNames: u.scopeNames,
      createdAt: this.clock.toIso(u.createdAt),
    };
  }
}
