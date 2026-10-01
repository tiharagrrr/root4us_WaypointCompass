import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { type Actor, isUserRole } from '@waypoint/shared';
import { and, eq, notInArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  ForbiddenError,
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { plans, sessions, trips, users } from '../../../db/schema';
import { AuditService } from '../../audit';
import { DriverHasTripsError } from '../domain/errors';
import {
  nextScope,
  sameScope,
  scopeErrors,
  type UserScope as Scope,
} from '../domain/user-scope';
import type { UpdateUserDto } from '../dto/user.dto';
import {
  IDENTITY_EVENTS,
  type UserAccessChangedEvent,
  type UserEvent,
} from '../events/identity.events';
import { UserScope } from '../policies/admin.scope';
import { PinService } from './pin.service';
import { ReferenceChecks } from './reference-checks';
import type { UserRow } from './user.queries';

/** Trips in these states no longer hold a driver to the day. */
const FINISHED_TRIPS = ['COMPLETED', 'CANCELLED'] as const;

/** Users on A1: role and scope changes, deactivation and loader PINs. */
@Injectable()
export class UsersService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: UserScope,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly references: ReferenceChecks,
    private readonly pins: PinService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(UsersService.name);
  }

  /**
   * Changes a user's role, scope or both. Their sessions are deleted in the
   * same transaction, so every device signs in again and gets the new
   * permissions at once. A change without a reasonCode is refused by
   * audit.record() and rolls back. Sending what the user already has changes
   * nothing and needs no reason.
   */
  @Transactional()
  async update(id: string, dto: UpdateUserDto, actor: Actor): Promise<UserRow> {
    const before = await this.load(id, actor);
    const current = scopeOf(before);
    const changes: Partial<Scope> = {
      role: dto.role,
      depotId: dto.depotId,
      outletId: dto.outletId,
      vehicleId: dto.vehicleId,
    };
    const next = nextScope(current, changes);
    const errors = [
      ...scopeErrors(next, changes, before.phoneNumberVerified === true),
      ...(await this.references.unknown(changes)),
    ];
    if (errors.length) throw new ValidationError(errors);

    const roleChanged = next.role !== current.role;
    if (!roleChanged && sameScope(next, current)) return before;

    const row = await this.write(id, {
      role: next.role,
      depotId: next.depotId,
      outletId: next.outletId,
      defaultVehicleId: next.vehicleId,
    });
    const revoked = await this.revokeSessions(id);

    const event = roleChanged
      ? IDENTITY_EVENTS.userRoleChanged
      : IDENTITY_EVENTS.userScopeChanged;
    await this.audit.record({
      action: event,
      entity: ['user', id],
      before: current,
      after: next,
      reasonCode: dto.reasonCode,
      reasonNote: dto.reasonNote,
    });
    const payload: UserAccessChangedEvent = {
      v: 1,
      userId: id,
      role: next.role,
      depotId: next.depotId,
      outletId: next.outletId,
    };
    await this.outbox.add(event, payload, { aggregate: ['user', id] });
    this.log.info(
      { event, userId: id, sessionsRevoked: revoked },
      roleChanged ? 'role changed' : 'scope changed',
    );
    return row;
  }

  /**
   * Stops the user signing in and ends their sessions; the row stays,
   * because audit rows point at it. A driver with a trip on today's business
   * date (demo clock) is refused with a link to reassign it.
   */
  @Transactional()
  async deactivate(id: string, actor: Actor): Promise<UserRow> {
    const before = await this.load(id, actor);
    if (before.banned)
      throw new StateConflictError('This user is already deactivated.');
    if (before.role === 'driver') {
      const tripId = await this.tripToday(id);
      if (tripId) throw new DriverHasTripsError(tripId);
    }

    const row = await this.write(id, { banned: true });
    const revoked = await this.revokeSessions(id);
    await this.recordUserEvent(IDENTITY_EVENTS.userDeactivated, id, {
      before: { banned: false },
      after: { banned: true },
    });
    this.log.info(
      {
        event: IDENTITY_EVENTS.userDeactivated,
        userId: id,
        sessionsRevoked: revoked,
      },
      'user deactivated',
    );
    return row;
  }

  @Transactional()
  async reactivate(id: string, actor: Actor): Promise<UserRow> {
    const before = await this.load(id, actor);
    if (!before.banned)
      throw new StateConflictError('This user is already active.');

    const row = await this.write(id, {
      banned: false,
      banReason: null,
      banExpires: null,
    });
    await this.recordUserEvent(IDENTITY_EVENTS.userReactivated, id, {
      before: { banned: true },
      after: { banned: false },
    });
    this.log.info(
      { event: IDENTITY_EVENTS.userReactivated, userId: id },
      'user reactivated',
    );
    return row;
  }

  /**
   * Sets a loader's dock PIN. 409 when the user isn't a loader with a depot,
   * or when another loader at one of their depots already holds that PIN.
   * Only the hash is stored, and neither appears in the audit row.
   */
  @Transactional()
  async setPin(id: string, pin: string, actor: Actor): Promise<UserRow> {
    const before = await this.load(id, actor);
    if (before.role !== 'loader')
      throw new StateConflictError('Only loaders sign in with a PIN.');
    const depotIds = await this.pins.depotsOf(before);
    if (!depotIds.length)
      throw new StateConflictError('Give the loader a depot first.');
    if (await this.pins.takenAt(depotIds, pin, id))
      throw new StateConflictError(
        'Another loader at this depot already uses that PIN. Choose another.',
      );

    const row = await this.write(id, { pinHash: await this.pins.hash(pin) });
    await this.recordUserEvent(IDENTITY_EVENTS.userPinSet, id, {
      after: { hasPin: true },
    });
    this.log.info(
      { event: IDENTITY_EVENTS.userPinSet, userId: id },
      'loader PIN set',
    );
    return row;
  }

  /** The user, locked for this transaction; 404 when missing or out of scope. */
  private async load(id: string, actor: Actor): Promise<UserRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), this.scope.where(actor)))
      .for('update');
    const user = this.scope.found(row);
    if (!isUserRole(user.role))
      throw new ForbiddenError('This account has no Waypoint role.');
    return user;
  }

  private async write(
    id: string,
    changes: Partial<typeof users.$inferInsert>,
  ): Promise<UserRow> {
    const [row] = await this.txHost.tx
      .update(users)
      .set({ ...changes, updatedAt: this.clock.realNow() })
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  /** Deletes every session of the user; returns how many there were. */
  private async revokeSessions(userId: string): Promise<number> {
    const gone = await this.txHost.tx
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });
    return gone.length;
  }

  private async recordUserEvent(
    event: string,
    userId: string,
    change: { before?: unknown; after?: unknown },
  ): Promise<void> {
    await this.audit.record({
      action: event,
      entity: ['user', userId],
      ...change,
    });
    const payload: UserEvent = { v: 1, userId };
    await this.outbox.add(event, payload, { aggregate: ['user', userId] });
  }

  /**
   * A trip of the driver's on today's business date that isn't finished.
   * Reads planning's trips and plans; writes nothing there.
   */
  private async tripToday(driverId: string): Promise<string | undefined> {
    const [trip] = await this.txHost.tx
      .select({ id: trips.id })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(
        and(
          eq(trips.driverId, driverId),
          eq(plans.date, this.clock.businessDate()),
          notInArray(trips.status, [...FINISHED_TRIPS]),
        ),
      )
      .limit(1);
    return trip?.id;
  }
}

function scopeOf(user: UserRow): Scope {
  if (!isUserRole(user.role))
    throw new ForbiddenError('This account has no Waypoint role.');
  return {
    role: user.role,
    depotId: user.depotId,
    outletId: user.outletId,
    vehicleId: user.defaultVehicleId,
  };
}
