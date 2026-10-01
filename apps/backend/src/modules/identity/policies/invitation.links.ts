import { Injectable } from '@nestjs/common';
import {
  type Actor,
  can,
  invitationMachine,
  isUserRole,
} from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { ForbiddenError } from '../../../core/errors/domain-errors';
import { compact, LinkBuilder, type LinkMap } from '../../../core/http/links';
import { credentialsFor, effectiveStatus } from '../domain/invitation';
import { maskPhone } from '../domain/mask-phone';
import type {
  AcceptedInvitationDto,
  InvitationDto,
  InvitationLandingDto,
} from '../dto/invitation.dto';
import type {
  InvitationRow,
  NamedInvitation,
} from '../services/invitation.queries';
import type { Accepted } from '../services/invitations.service';

/**
 * An invitation on A1. Expiry is real time, so the status and the links
 * read ClockService.realNow(), not the demo clock.
 */
@Injectable()
export class InvitationLinks extends LinkBuilder<
  NamedInvitation,
  Omit<InvitationDto, '_links'>
> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(i: NamedInvitation) {
    return `/api/v1/invitations/${i.id}`;
  }

  protected actions(i: NamedInvitation, actor: Actor): LinkMap {
    const status = effectiveStatus(i, this.clock.realNow());
    const manage = can(actor, 'user:create');
    return {
      resend: invitationMachine.can(status, 'RESEND') &&
        manage && {
          href: `${this.self(i)}/resend`,
          method: 'POST',
          title: 'Resend',
          requires: ['Idempotency-Key'],
        },
      revoke: invitationMachine.can(status, 'REVOKE') &&
        manage && {
          href: `${this.self(i)}/revoke`,
          method: 'POST',
          title: 'Revoke',
        },
    };
  }

  /** The invite landing's view of the invitation behind a link: no ids, phone masked. */
  landing(i: InvitationRow, token: string): InvitationLandingDto {
    const status = effectiveStatus(i, this.clock.realNow());
    if (!isUserRole(i.role))
      throw new ForbiddenError('This invitation has no Waypoint role.');
    return {
      name: i.name,
      role: i.role,
      status,
      expiresAt: this.clock.toIso(i.expiresAt),
      email: i.email,
      phoneNumber: i.phoneNumber ? maskPhone(i.phoneNumber) : null,
      accepts: credentialsFor(i),
      _links: compact({
        self: { href: `/api/v1/invitations/by-token/${token}` },
        accept: invitationMachine.can(status, 'ACCEPT') && {
          href: `/api/v1/invitations/${token}/accept`,
          method: 'POST',
          title: 'Accept invitation',
        },
        sendCode: invitationMachine.can(status, 'ACCEPT') &&
          i.role === 'driver' && {
            href: '/api/auth/phone-number/send-otp',
            method: 'POST',
            title: 'Send me a code',
          },
      }),
    };
  }

  accepted(result: Accepted): AcceptedInvitationDto {
    return {
      userId: result.user.id,
      name: result.user.name,
      role: result.user.role,
      signedIn: result.cookies.length > 0,
      _links: compact({
        me: result.cookies.length > 0 && { href: '/api/v1/me' },
        root: result.cookies.length > 0 && { href: '/api/v1' },
      }),
    };
  }

  protected present(i: NamedInvitation): Omit<InvitationDto, '_links'> {
    if (!isUserRole(i.role))
      throw new ForbiddenError('This invitation has no Waypoint role.');
    const iso = (at: Date | null) => (at ? this.clock.toIso(at) : null);
    return {
      id: i.id,
      name: i.name,
      email: i.email,
      phoneNumber: i.phoneNumber,
      role: i.role,
      depotId: i.depotId,
      outletId: i.outletId,
      vehicleId: i.vehicleId,
      scopeNames: i.scopeNames,
      status: effectiveStatus(i, this.clock.realNow()),
      expiresAt: this.clock.toIso(i.expiresAt),
      sentAt: iso(i.sentAt),
      acceptedAt: iso(i.acceptedAt),
      createdAt: this.clock.toIso(i.createdAt),
    };
  }
}
