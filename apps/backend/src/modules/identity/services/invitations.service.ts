import { Inject, Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  type Actor,
  type InvitationStatus,
  invitationMachine,
  isUserRole,
  type UserRole,
} from '@waypoint/shared';
import { APIError } from 'better-auth/api';
import { and, eq, gt, or, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../../../config/app-config';
import { ClockService } from '../../../core/clock/clock.service';
import {
  type FieldError,
  ForbiddenError,
  NotFoundError,
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { invitations, users } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { Auth } from '../auth/auth';
import { AuthMessages } from '../auth/auth-messages';
import { AUTH } from '../auth/auth.module';
import {
  channelOf,
  credentialsFor,
  effectiveStatus,
  hashToken,
  INVITATION_TTL_MS,
  invitationErrors,
  newToken,
} from '../domain/invitation';
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
} from '../dto/invitation.dto';
import {
  IDENTITY_EVENTS,
  type InvitationRevokedEvent,
  type UserInvitedEvent,
  type UserJoinedEvent,
} from '../events/identity.events';
import { InvitationScope } from '../policies/admin.scope';
import type { InvitationRow } from './invitation.queries';
import { PinService } from './pin.service';
import { ReferenceChecks } from './reference-checks';

/** Why an invitation can't be accepted, as the invite landing shows it. */
const REFUSED: Partial<Record<InvitationStatus, string>> = {
  EXPIRED: 'This invitation has expired. Ask your admin to send a new one.',
  ACCEPTED: 'This invitation has already been used. Sign in instead.',
  REVOKED: 'This invitation was withdrawn. Ask your admin for a new one.',
};

/** BetterAuth's phone code errors, as the invite landing shows them. */
const CODE_REFUSED: Record<string, string> = {
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Ask for a new code.',
  OTP_EXPIRED: 'That code has expired. Ask for a new code.',
};

export interface Accepted {
  user: { id: string; name: string; role: UserRole };
  /** Set-Cookie values for the new session; none for loaders. */
  cookies: string[];
}

/**
 * Invitations (A1, A2 and the invite landing). The link's token goes out
 * once, in the delivery job; the row keeps its sha256. Expiry is 72 hours of
 * real time and is read, not written (effectiveStatus).
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: InvitationScope,
    private readonly clock: ClockService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly references: ReferenceChecks,
    private readonly pins: PinService,
    private readonly messages: AuthMessages,
    @Inject(AUTH) private readonly auth: Auth,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(InvitationsService.name);
  }

  /**
   * Sends an invitation (AC-IDN-39, 41). 400 when the fields don't fit the
   * role, 409 when someone already has an account or a live invitation with
   * that email or phone.
   */
  @Transactional()
  async create(dto: CreateInvitationDto, actor: Actor): Promise<InvitationRow> {
    const email = dto.email?.toLowerCase() ?? null;
    const errors = [
      ...invitationErrors({ ...dto, email }),
      ...(await this.references.unknown(dto)),
    ];
    if (errors.length) throw new ValidationError(errors);
    await this.refuseTakenContact(email, dto.phoneNumber ?? null);

    const token = newToken();
    const now = this.clock.realNow();
    const [row] = await this.txHost.tx
      .insert(invitations)
      .values({
        name: dto.name,
        role: dto.role,
        email,
        phoneNumber: dto.phoneNumber ?? null,
        depotId: dto.depotId ?? null,
        outletId: dto.outletId ?? null,
        vehicleId: dto.vehicleId ?? null,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        sentAt: now,
        invitedById: actor.id,
      })
      .returning();

    await this.audit.record({
      action: 'identity.invitation.created',
      entity: ['invitation', row.id],
      after: auditView(row),
    });
    await this.emitInvited(row, false);
    await this.send(row, token);
    this.log.info(
      {
        event: 'identity.invitation.created',
        invitationId: row.id,
        role: row.role,
      },
      'invitation created',
    );
    return row;
  }

  /** A new token and 72 hours for a PENDING or EXPIRED invitation (AC-IDN-47). */
  @Transactional()
  async resend(id: string, actor: Actor): Promise<InvitationRow> {
    const before = await this.load(id, actor);
    const status = this.statusOf(before);
    if (!invitationMachine.can(status, 'RESEND'))
      throw new StateConflictError(
        `A ${status.toLowerCase()} invitation can't be resent.`,
      );

    const token = newToken();
    const now = this.clock.realNow();
    const [row] = await this.txHost.tx
      .update(invitations)
      .set({
        status: 'PENDING',
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        sentAt: now,
      })
      .where(eq(invitations.id, id))
      .returning();

    await this.audit.record({
      action: 'identity.invitation.resent',
      entity: ['invitation', id],
      before: { status, expiresAt: before.expiresAt },
      after: { status: row.status, expiresAt: row.expiresAt },
    });
    await this.emitInvited(row, true);
    await this.send(row, token);
    this.log.info(
      { event: 'identity.invitation.resent', invitationId: id },
      'invitation resent',
    );
    return row;
  }

  /** Withdraws a PENDING or EXPIRED invitation; its link stops working (AC-IDN-48). */
  @Transactional()
  async revoke(id: string, actor: Actor): Promise<InvitationRow> {
    const before = await this.load(id, actor);
    const status = this.statusOf(before);
    if (!invitationMachine.can(status, 'REVOKE'))
      throw new StateConflictError(
        `A ${status.toLowerCase()} invitation can't be revoked.`,
      );

    const [row] = await this.txHost.tx
      .update(invitations)
      .set({ status: 'REVOKED' })
      .where(eq(invitations.id, id))
      .returning();
    await this.audit.record({
      action: 'identity.invitation.revoked',
      entity: ['invitation', id],
      before: { status },
      after: { status: 'REVOKED' },
    });
    const payload: InvitationRevokedEvent = { v: 1, invitationId: id };
    await this.outbox.add(IDENTITY_EVENTS.invitationRevoked, payload, {
      aggregate: ['invitation', id],
    });
    this.log.info(
      { event: 'identity.invitation.revoked', invitationId: id },
      'invitation revoked',
    );
    return row;
  }

  /** The invitation behind a link, for the landing (AC-IDN-42); 404 for an unknown or replaced token. */
  async byToken(token: string): Promise<InvitationRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(token)));
    if (!row) throw new NotFoundError('invitation');
    return row;
  }

  /**
   * Accepts an invitation (AC-IDN-03, 43 to 46, 48): 404 for an unknown
   * token, 409 once it is EXPIRED, ACCEPTED or REVOKED, 400 without the
   * credentials the role needs or when they don't match the invitation.
   * The account is created through BetterAuth's createUser; email roles and
   * drivers are signed in, loaders sign in at the dock with their PIN.
   */
  @Transactional()
  async accept(token: string, dto: AcceptInvitationDto): Promise<Accepted> {
    const [invitation] = await this.txHost.tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(token)))
      .for('update');
    if (!invitation) throw new NotFoundError('invitation');
    const status = this.statusOf(invitation);
    if (!invitationMachine.can(status, 'ACCEPT'))
      throw new StateConflictError(REFUSED[status]);
    const role = invitation.role;
    if (!isUserRole(role))
      throw new ForbiddenError('This invitation has no Waypoint role.');

    this.checkCredentials(invitation, dto);
    if (role === 'driver') await this.consumeCode(dto.phoneNumber!, dto.code!);
    if (
      role === 'loader' &&
      invitation.depotId &&
      (await this.pins.takenAt([invitation.depotId], dto.pin!))
    )
      throw new StateConflictError(
        'Another loader at this depot already uses that PIN. Choose another.',
      );
    await this.refuseTakenAccount(invitation.email, invitation.phoneNumber);

    const user = await this.createUser(invitation, role, dto);
    await this.txHost.tx
      .update(invitations)
      .set({
        status: 'ACCEPTED',
        acceptedAt: this.clock.realNow(),
        userId: user.id,
      })
      .where(eq(invitations.id, invitation.id));
    await this.audit.record({
      action: 'identity.invitation.accepted',
      entity: ['invitation', invitation.id],
      before: { status },
      after: { status: 'ACCEPTED', userId: user.id },
      actorName: invitation.name,
    });
    const payload: UserJoinedEvent = {
      v: 1,
      userId: user.id,
      invitationId: invitation.id,
      role,
    };
    await this.outbox.add(IDENTITY_EVENTS.userJoined, payload, {
      aggregate: ['user', user.id],
    });
    this.log.info(
      {
        event: 'identity.invitation.accepted',
        invitationId: invitation.id,
        userId: user.id,
        role,
      },
      'invitation accepted',
    );

    const cookies = role === 'loader' ? [] : await this.signIn(user.id);
    return { user: { id: user.id, name: user.name, role }, cookies };
  }

  private statusOf(row: InvitationRow): InvitationStatus {
    return effectiveStatus(row, this.clock.realNow());
  }

  private async load(id: string, actor: Actor): Promise<InvitationRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, id), this.scope.where(actor)))
      .for('update');
    return this.scope.found(row);
  }

  /** 409 when an account, or a live invitation, already has this email or phone. */
  private async refuseTakenContact(
    email: string | null,
    phoneNumber: string | null,
  ): Promise<void> {
    await this.refuseTakenAccount(email, phoneNumber);
    const contact = or(
      email ? eq(invitations.email, email) : undefined,
      phoneNumber ? eq(invitations.phoneNumber, phoneNumber) : undefined,
    );
    if (!contact) return;
    const live = await this.txHost.tx.$count(
      invitations,
      and(
        contact,
        eq(invitations.status, 'PENDING'),
        gt(invitations.expiresAt, this.clock.realNow()),
      ),
    );
    if (live)
      throw new StateConflictError(
        'This person already has a pending invitation. Resend it instead.',
      );
  }

  private async refuseTakenAccount(
    email: string | null,
    phoneNumber: string | null,
  ): Promise<void> {
    const contact = or(
      email ? sql`lower(${users.email}) = ${email.toLowerCase()}` : undefined,
      phoneNumber ? eq(users.phoneNumber, phoneNumber) : undefined,
    );
    if (contact && (await this.txHost.tx.$count(users, contact)))
      throw new StateConflictError(
        'Someone already has an account with this email or phone number.',
      );
  }

  /** 400 for a missing credential, or an email or phone that isn't the invited one. */
  private checkCredentials(
    invitation: InvitationRow,
    dto: AcceptInvitationDto,
  ): void {
    const errors: FieldError[] = credentialsFor(invitation)
      .filter((field) => !dto[field])
      .map((field) => ({
        field,
        code: 'required',
        message: 'This field is required to accept',
      }));
    if (
      dto.email &&
      dto.email.toLowerCase() !== invitation.email?.toLowerCase()
    )
      errors.push({
        field: 'email',
        code: 'mismatch',
        message: 'Use the email address the invitation was sent to',
      });
    if (dto.phoneNumber && dto.phoneNumber !== invitation.phoneNumber)
      errors.push({
        field: 'phoneNumber',
        code: 'mismatch',
        message: 'Use the phone number the invitation was sent to',
      });
    if (errors.length) throw new ValidationError(errors);
  }

  /** Checks and uses up the code BetterAuth sent to the invited phone. */
  private async consumeCode(phoneNumber: string, code: string): Promise<void> {
    try {
      await this.auth.api.consumePhoneNumberOTP({
        body: { phoneNumber, code },
      });
    } catch (err) {
      if (!(err instanceof APIError)) throw err;
      const reason = String(err.body?.code ?? '');
      throw new ValidationError([
        {
          field: 'code',
          code:
            reason === 'TOO_MANY_ATTEMPTS' ? 'too_many_attempts' : 'invalid',
          message: CODE_REFUSED[reason] ?? 'That code is not right',
        },
      ]);
    }
  }

  /**
   * Creates the account through BetterAuth on its own connection, so it
   * commits before this transaction does; never lock the new row here. Drivers, and loaders invited by
   * phone, get <id>@drivers.waypoint.local or <id>@loaders.waypoint.local.
   */
  private async createUser(
    invitation: InvitationRow,
    role: UserRole,
    dto: AcceptInvitationDto,
  ): Promise<{ id: string; name: string }> {
    const placeholder = role === 'driver' || !invitation.email;
    const domain = role === 'driver' ? 'drivers' : 'loaders';
    const signsInWithPassword = role !== 'driver' && role !== 'loader';
    const { user } = await this.auth.api.createUser({
      body: {
        email: placeholder
          ? `invite-${invitation.id}@${domain}.waypoint.local`
          : invitation.email!,
        password: signsInWithPassword ? dto.password : undefined,
        name: invitation.name,
        role,
        data: {
          emailVerified: !placeholder,
          depotId: invitation.depotId,
          outletId: invitation.outletId,
          defaultVehicleId: invitation.vehicleId,
          phoneNumber: invitation.phoneNumber,
          phoneNumberVerified: role === 'driver' ? true : null,
          ...(role === 'loader'
            ? await this.pins.columns(dto.pin!)
            : { pinHash: null }),
        },
      },
    });
    // Through BetterAuth's connection, like createUser: a lock on the row from
    // this transaction would block the session insert in signIn().
    if (placeholder) {
      const ctx = await this.auth.$context;
      await ctx.internalAdapter.updateUser(user.id, {
        email: `${user.id}@${domain}.waypoint.local`,
      });
    }
    return user;
  }

  /** A session for the new account; returns its Set-Cookie values. */
  private async signIn(userId: string): Promise<string[]> {
    const { headers } = await this.auth.api.createInvitationSession({
      body: { userId },
      returnHeaders: true,
    });
    return headers.getSetCookie();
  }

  private async emitInvited(row: InvitationRow, resend: boolean) {
    if (!isUserRole(row.role))
      throw new ForbiddenError('This invitation has no Waypoint role.');
    const payload: UserInvitedEvent = {
      v: 1,
      invitationId: row.id,
      role: row.role,
      channel: channelOf(row),
      resend,
    };
    await this.outbox.add(IDENTITY_EVENTS.userInvited, payload, {
      aggregate: ['invitation', row.id],
    });
  }

  /** Queues the message with the link: the only place the raw token goes. */
  private async send(row: InvitationRow, token: string): Promise<void> {
    const channel = channelOf(row);
    await this.messages.enqueueInvite({
      v: 1,
      invitationId: row.id,
      channel,
      to: channel === 'sms' ? row.phoneNumber! : row.email!,
      name: row.name,
      link: `${this.config.appUrl}/invite/${token}`,
      expiresAt: this.clock.toIso(row.expiresAt),
    });
  }
}

/** What the audit row keeps of an invitation: no contact details or token hash. */
function auditView(row: InvitationRow) {
  return {
    role: row.role,
    depotId: row.depotId,
    outletId: row.outletId,
    vehicleId: row.vehicleId,
    channel: channelOf(row),
    expiresAt: row.expiresAt,
  };
}
