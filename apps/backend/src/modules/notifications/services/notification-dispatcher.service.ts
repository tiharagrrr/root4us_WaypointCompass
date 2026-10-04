import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import type { ContextualJobData } from '../../../core/context/job-context';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { notifications } from '../../../db/schema';
import { QUEUES } from '../../../queues';
import { and, eq, gt, sql } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import { SettingsService } from '../../../core/settings/settings.service';
import { PresenceService } from '../../realtime';
import {
  CATALOG,
  type CatalogEntry,
  type Payload,
  type RuleContext,
} from '../domain/catalog';
import { channelsFor, dedupeKeyOf } from '../domain/channels';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_LOGS,
  NOTIFY_SEND_JOB,
  SEND_ATTEMPTS,
} from '../notifications.constants';
import { RecipientsService } from './recipients.service';

export interface SendJob extends ContextualJobData {
  notificationId: string;
}

/**
 * Turns one relayed event into Notification rows (specs/notifications,
 * Pipeline): the catalog's audiences, then each person's channels, then one
 * row per event, person and channel. The row's dedupe key is unique, so a
 * replayed event inserts nothing and queues nothing (AC-NTF-02).
 *
 * In-app rows are the record and need no provider: each one is announced to
 * its user on the outbox, which the SSE stream carries to the 02 bell. Email,
 * SMS and push rows go to the worker's notify.send job, because a provider
 * never runs inside the relay's transaction.
 */
@Injectable()
export class NotificationDispatcher {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly recipients: RecipientsService,
    private readonly outbox: OutboxService,
    @InjectQueue(QUEUES.notifications) private readonly queue: Queue,
    private readonly settings: SettingsService,
    private readonly presence: PresenceService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(NotificationDispatcher.name);
  }

  @Transactional()
  async handle(event: DeliveredEvent): Promise<{ created: number }> {
    const entries = CATALOG[event.type] ?? [];
    const payload = (event.payload ?? {}) as Payload;
    const toSend: string[] = [];
    let created = 0;

    let context: RuleContext | undefined;
    for (const entry of entries) {
      if (entry.when) {
        context ??= await this.contextFor(event);
        if (!entry.when(payload, context)) continue;
      }
      const people = await this.recipients.resolve(entry.to, event);
      // No push to someone with the app open: the in-app line reaches them (AC-NTF-12).
      const watching = entry.channels.includes('PUSH')
        ? await this.presence
            .watching(people.map((p) => p.userId))
            .catch(() => new Set<string>())
        : new Set<string>();
      const collapseKey = entry.collapse?.key(payload) ?? null;
      for (const person of people) {
        if (
          collapseKey &&
          (await this.recentlyTold(person.userId, collapseKey, entry))
        ) {
          this.log.debug(
            {
              event: NOTIFICATION_LOGS.quiet,
              eventId: event.id,
              userId: person.userId,
            },
            'collapsed into an earlier notice',
          );
          continue;
        }
        const facts = await this.recipients.facts(payload, person);
        const message = entry.message(payload, facts);
        if (!message) continue;
        const reach = watching.has(person.userId)
          ? { ...person, push: false }
          : person;
        for (const channel of channelsFor(
          entry.channels,
          reach,
          person.preference,
        )) {
          const [row] = await this.txHost.tx
            .insert(notifications)
            .values({
              userId: person.userId,
              eventType: event.type,
              channel,
              // In-app needs no provider: it is delivered the moment it exists.
              status: channel === 'IN_APP' ? 'SENT' : 'QUEUED',
              title: message.title,
              body: message.body,
              data: {
                link: message.link,
                eventId: event.id,
                ...(collapseKey && { collapseKey }),
                entity: { type: event.aggregateType, id: event.aggregateId },
              },
              dedupeKey: dedupeKeyOf(event.id, person.userId, channel),
              // Business time, so the bell's days and the burst window follow the demo clock.
              createdAt: this.clock.now(),
            })
            .onConflictDoNothing({ target: notifications.dedupeKey })
            .returning({ id: notifications.id });
          if (!row) continue;
          created += 1;
          if (channel === 'IN_APP')
            await this.outbox.add(
              NOTIFICATION_EVENTS.created,
              { v: 1, notificationId: row.id, eventType: event.type },
              { aggregate: ['notification', row.id], userIds: [person.userId] },
            );
          else toSend.push(row.id);
        }
      }
    }

    for (const id of toSend)
      await this.queue.add(
        NOTIFY_SEND_JOB,
        { notificationId: id } satisfies SendJob,
        {
          jobId: `notify-${id}`,
          // The row commits with the relay's transaction; give it that long.
          delay: 1_000,
          attempts: SEND_ATTEMPTS,
          backoff: { type: 'notify' },
          removeOnComplete: true,
          removeOnFail: 500,
        },
      );

    if (created)
      this.log.info(
        {
          event: NOTIFICATION_LOGS.dispatched,
          eventId: event.id,
          type: event.type,
          created,
        },
        'notifications created',
      );
    return { created };
  }

  private async contextFor(event: DeliveredEvent): Promise<RuleContext> {
    return {
      etaSlipMinutes: await this.settings.get(
        'tracking.etaSlipNotifyMinutes',
        event.depotId,
      ),
    };
  }

  /** Whether this person already heard about this key inside the entry's burst window. */
  private async recentlyTold(
    userId: string,
    collapseKey: string,
    entry: CatalogEntry,
  ): Promise<boolean> {
    const since = new Date(
      this.clock.now().getTime() - (entry.collapse?.minutes ?? 0) * 60_000,
    );
    const [hit] = await this.txHost.tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          sql`${notifications.data}->>'collapseKey' = ${collapseKey}`,
          gt(notifications.createdAt, since),
        ),
      )
      .limit(1);
    return Boolean(hit);
  }
}
