import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { notifications } from '../../../db/schema';
import { AuditService } from '../../audit';
import {
  NOTIFICATION_AUDIT,
  NOTIFICATION_EVENTS,
  NOTIFICATION_LOGS,
} from '../notifications.constants';
import { NotificationScope } from '../policies/notification.scope';
import {
  NotificationQueries,
  type NotificationRow,
} from './notification.queries';

/**
 * Marking bell lines read. Reading is a state change like any other: audited
 * (so reading a store's deferral notice is on the record, AC-NTF-09) and
 * announced to the reader's other tabs. Reading a read line changes nothing
 * and records nothing.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly queries: NotificationQueries,
    private readonly scope: NotificationScope,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(NotificationsService.name);
  }

  @Transactional()
  async markRead(id: string, actor: Actor): Promise<NotificationRow> {
    const row = await this.queries.get(id, actor);
    if (row.readAt) return row;
    const [saved] = await this.txHost.tx
      .update(notifications)
      .set({ status: 'READ', readAt: this.clock.now() })
      .where(and(eq(notifications.id, id), isNull(notifications.readAt)))
      .returning();
    await this.audit.record({
      action: NOTIFICATION_AUDIT.read,
      entity: ['notification', id],
      before: { readAt: null },
      after: {
        readAt: this.clock.toIso(saved.readAt!),
        eventType: row.eventType,
      },
    });
    await this.outbox.add(
      NOTIFICATION_EVENTS.read,
      { v: 1, notificationIds: [id] },
      { aggregate: ['notification', id], userIds: [actor.id] },
    );
    this.log.info(
      { event: NOTIFICATION_LOGS.read, notificationId: id },
      'notification read',
    );
    return saved;
  }

  @Transactional()
  async markAllRead(actor: Actor): Promise<{ marked: number }> {
    const rows = await this.txHost.tx
      .update(notifications)
      .set({ status: 'READ', readAt: this.clock.now() })
      .where(and(this.scope.where(actor), isNull(notifications.readAt)))
      .returning({ id: notifications.id, eventType: notifications.eventType });
    if (!rows.length) return { marked: 0 };
    await this.audit.record({
      action: NOTIFICATION_AUDIT.allRead,
      entity: ['user', actor.id],
      after: {
        marked: rows.length,
        notificationIds: rows.map((r) => r.id),
      },
    });
    await this.outbox.add(
      NOTIFICATION_EVENTS.read,
      { v: 1, notificationIds: rows.map((r) => r.id) },
      { aggregate: ['user', actor.id], userIds: [actor.id] },
    );
    this.log.info(
      { event: NOTIFICATION_LOGS.read, marked: rows.length },
      'notifications read',
    );
    return { marked: rows.length };
  }
}
