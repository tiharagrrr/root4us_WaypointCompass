import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor, NotificationChannel } from '@waypoint/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  NotFoundError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { devices, notificationPreferences, users } from '../../../db/schema';
import { AuditService } from '../../audit';
import { CATALOG, EVENT_LABELS, ROLE_OF } from '../domain/catalog';
import { channelsFor, realEmail } from '../domain/channels';
import { FIXTURES } from '../domain/fixtures';
import { ALL_EVENTS, NOTIFICATION_AUDIT } from '../notifications.constants';

const ORDER: NotificationChannel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];

export interface PreferenceRow {
  eventType: string;
  label: string;
  /** What it says, from the catalog's example. */
  example: string | null;
  /** The catalog's channels for this role, in-app included. */
  defaults: NotificationChannel[];
  /** Of those, what this person can receive now (no address, no phone, no push: left out). */
  available: NotificationChannel[];
  /** What they get: their choice, or the defaults. */
  channels: NotificationChannel[];
  /** True when they have changed it from the defaults. */
  custom: boolean;
}

export interface PreferenceSheet {
  items: PreferenceRow[];
  /** Email is off for everything after a bounce or complaint (AC-NTF-08). */
  emailSuppressed: boolean;
}

/**
 * The person's own notification preferences (D12, 02's Settings): one row per
 * catalog event that reaches their role. In-app can't be switched off; a
 * channel they can't receive is shown as unavailable rather than offered.
 */
@Injectable()
export class PreferencesService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly audit: AuditService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(PreferencesService.name);
  }

  async sheet(actor: Actor): Promise<PreferenceSheet> {
    const tx = this.txHost.tx;
    const [me] = await tx
      .select({
        email: users.email,
        phone: users.phoneNumber,
        verified: users.phoneNumberVerified,
      })
      .from(users)
      .where(eq(users.id, actor.id));
    const [pusher] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, actor.id), isNotNull(devices.pushEndpoint)))
      .limit(1);
    const rows = await tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, actor.id));
    const saved = new Map(rows.map((r) => [r.eventType, r.channels]));
    const all = saved.get(ALL_EVENTS) ?? null;
    const reach = {
      email: realEmail(me?.email),
      phone: me?.verified ? (me.phone ?? null) : null,
      push: Boolean(pusher),
    };

    const items = this.eventsFor(actor).map((eventType): PreferenceRow => {
      const defaults = this.defaultsOf(eventType, actor);
      const own = saved.get(eventType) ?? null;
      const chosen = own
        ? all
          ? own.filter((c) => all.includes(c))
          : own
        : all;
      return {
        eventType,
        label: EVENT_LABELS[eventType] ?? eventType,
        example: this.example(eventType, actor),
        defaults,
        available: channelsFor(defaults, reach, null),
        channels: channelsFor(defaults, reach, chosen),
        custom: own !== null,
      };
    });
    return { items, emailSuppressed: all !== null && !all.includes('EMAIL') };
  }

  @Transactional()
  async update(
    actor: Actor,
    eventType: string,
    channels: NotificationChannel[],
  ): Promise<PreferenceRow> {
    if (!this.eventsFor(actor).includes(eventType))
      throw new NotFoundError('notification preference');
    const defaults = this.defaultsOf(eventType, actor);
    const outside = channels.filter((c) => !defaults.includes(c));
    if (outside.length)
      throw new ValidationError([
        {
          field: 'channels',
          code: 'not_offered',
          message: `${eventType} is not sent by ${outside.join(', ')}`,
        },
      ]);
    // In-app is the record of every notification; it can't be switched off.
    const next = ORDER.filter((c) => c === 'IN_APP' || channels.includes(c));
    const [before] = await this.txHost.tx
      .select({ channels: notificationPreferences.channels })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, actor.id),
          eq(notificationPreferences.eventType, eventType),
        ),
      );
    await this.txHost.tx
      .insert(notificationPreferences)
      .values({ userId: actor.id, eventType, channels: next })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.eventType,
        ],
        set: { channels: next },
      });
    await this.audit.record({
      action: NOTIFICATION_AUDIT.preferenceChanged,
      entity: ['user', actor.id],
      before: { eventType, channels: before?.channels ?? defaults },
      after: { eventType, channels: next },
    });
    this.log.info(
      { event: NOTIFICATION_AUDIT.preferenceChanged, eventType },
      'notification preference changed',
    );
    const sheet = await this.sheet(actor);
    return sheet.items.find((i) => i.eventType === eventType)!;
  }

  /** Email back on for everything, after the person fixed their address. */
  @Transactional()
  async resumeEmail(actor: Actor): Promise<PreferenceSheet> {
    const removed = await this.txHost.tx
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, actor.id),
          inArray(notificationPreferences.eventType, [ALL_EVENTS]),
        ),
      )
      .returning({ channels: notificationPreferences.channels });
    if (removed.length)
      await this.audit.record({
        action: NOTIFICATION_AUDIT.preferenceChanged,
        entity: ['user', actor.id],
        before: { eventType: ALL_EVENTS, channels: removed[0].channels },
        after: { eventType: ALL_EVENTS, channels: null },
      });
    return this.sheet(actor);
  }

  /** Catalog events with an audience of this person's role. */
  private eventsFor(actor: Actor): string[] {
    return Object.entries(CATALOG)
      .filter(([, entries]) =>
        entries.some((e) => ROLE_OF[e.to] === actor.role),
      )
      .map(([type]) => type);
  }

  private defaultsOf(eventType: string, actor: Actor): NotificationChannel[] {
    const offered = new Set<NotificationChannel>(['IN_APP']);
    for (const entry of CATALOG[eventType] ?? [])
      if (ROLE_OF[entry.to] === actor.role)
        for (const c of entry.channels) offered.add(c);
    return ORDER.filter((c) => offered.has(c));
  }

  private example(eventType: string, actor: Actor): string | null {
    const fixture = FIXTURES[eventType];
    const entry = CATALOG[eventType]?.find((e) => ROLE_OF[e.to] === actor.role);
    return (
      (fixture && entry?.message(fixture.payload, fixture.facts)?.body) ?? null
    );
  }
}
